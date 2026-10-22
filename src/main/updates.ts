import { app, BrowserWindow, ipcMain, net, shell, type IpcMainEvent } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { access, chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { IPC } from '../shared/api'
import {
  CHECK_INTERVAL_MS,
  WAITING_CHECK_MS,
  WAITING_CHECKS,
  WaitingRechecks,
  INSTALL_SCRIPT,
  installPaths,
  installTarget,
  LATEST_RELEASE_URL,
  newerRelease,
  parseVersion,
  RELEASES_URL,
  type InstallKind,
  type Release,
  type UpdateState
} from '../core/updates'

export interface MainUpdates {
  /** Starts the launch check and the periodic ones; call once the app is ready. */
  start(): void
  /** A check the user asked for: also shows a skipped version, and up to date. */
  check(): void
  /** At quit: installs a downloaded update (unless skipped), without relaunching. */
  installAtQuit(): void
}

/**
 * Only a development build honours these, so smoke tests can drive the updater with a local feed:
 * the release JSON's URL, the version to compare with, the file or folder an install replaces,
 * and how soon and how often a release whose file isn't up yet is checked again. A packaged app
 * always checks GitHub with its own version and location.
 */
function testOverrides(): {
  feed: string
  current: string
  target: string | null
  waitingMs: number | null
  waitingChecks: number | null
} | null {
  const feed = process.env['BIKUBE_UPDATE_FEED']
  if (app.isPackaged || !feed) return null
  const waitingMs = Number(process.env['BIKUBE_UPDATE_WAITING_MS'])
  const waitingChecks = Number(process.env['BIKUBE_UPDATE_WAITING_CHECKS'])
  return {
    feed,
    current: process.env['BIKUBE_UPDATE_CURRENT'] ?? '0.0.0',
    target: process.env['BIKUBE_UPDATE_TARGET'] || null,
    waitingMs: Number.isInteger(waitingMs) && waitingMs > 0 ? waitingMs : null,
    waitingChecks: Number.isInteger(waitingChecks) && waitingChecks > 0 ? waitingChecks : null
  }
}

/** The update the user skipped, kept in `<userData>/bikube-update.json`. */
function skipFile(): { read(): string | null; write(version: string): void } {
  const path = join(app.getPath('userData'), 'bikube-update.json')
  return {
    read: () => {
      try {
        const v = (JSON.parse(readFileSync(path, 'utf8')) as { skipped?: unknown }).skipped
        return typeof v === 'string' && parseVersion(v) ? v : null
      } catch {
        return null
      }
    },
    write: (version) => {
      try {
        writeFileSync(path, JSON.stringify({ skipped: version }) + '\n')
      } catch (err) {
        console.error(`skipped update not saved: ${String(err)}`)
      }
    }
  }
}

const run = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile(command, args, (error, _out, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve()
    )
  )

/**
 * Updates from GitHub Releases (see `src/core/updates.ts`): checked at launch and every few
 * hours, this platform's file downloaded and checked against its SHA-256, and installed by a
 * detached script once Bikube has quit, on Install and Relaunch or at the next quit.
 */
export function registerUpdates(runningTerminals: () => number): MainUpdates {
  const test = testOverrides()
  const enabled = app.isPackaged || test !== null
  const current = test?.current ?? app.getVersion()
  const feed = test?.feed ?? LATEST_RELEASE_URL
  const waitingCheckMs = test?.waitingMs ?? WAITING_CHECK_MS
  const base = test ? new URL('/', test.feed).toString() : RELEASES_URL
  const target = test
    ? test.target && {
        kind: process.platform === 'darwin' ? ('mac' as const) : ('appimage' as const),
        path: test.target
      }
    : installTarget({
        platform: process.platform,
        exePath: app.getPath('exe'),
        appImage: process.env['APPIMAGE']
      })
  const dir = join(app.getPath('userData'), 'updates')
  const skips = skipFile()
  // Why the last install's script couldn't swap the app (it reopened the old one): said once.
  const failedFile = join(app.getPath('userData'), 'update-install-failed')
  let lastFailure: string | null = null
  try {
    lastFailure = readFileSync(failedFile, 'utf8').trim() || 'unknown reason'
    rmSync(failedFile, { force: true })
  } catch {
    // No failed install.
  }

  let state: UpdateState = enabled ? { kind: 'idle' } : { kind: 'off' }
  /** The downloaded, ready app (a `.app` folder or an AppImage file) for `state`'s release. */
  let prepared: { version: string; path: string } | null = null
  let downloading: string | null = null
  let installing = false

  const publish = (next: UpdateState): void => {
    state = next
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(IPC.updateStateChanged, state)
  }
  const patch = (fields: Partial<Extract<UpdateState, { kind: 'available' }>>): void => {
    if (state.kind === 'available') publish({ ...state, ...fields })
  }

  /** How this install takes `release`: by itself where it can write its own app, else by hand. */
  async function installKind(release: Release): Promise<InstallKind> {
    if (!target || (!release.asset && !release.waiting)) return 'manual'
    try {
      // `access` alone: a standard account owns its `Bikube.app` but can't write `/Applications`.
      for (const path of installPaths(target.kind, '', target.path).writable)
        await access(path, constants.W_OK)
      return target.kind
    } catch {
      return 'manual'
    }
  }

  async function check(manual: boolean): Promise<void> {
    if (!enabled || state.kind === 'checking' || downloading) return
    const before = state
    if (manual || before.kind !== 'available') publish({ kind: 'checking' })
    let release: Release | null
    try {
      const response = await net.fetch(feed, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30_000)
      })
      // No release yet answers 404.
      if (response.status === 404) release = null
      else if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      else
        release = newerRelease(await response.json(), {
          current,
          platform: process.platform,
          arch: process.arch,
          base
        })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A background check that fails keeps what was shown; only an asked-for one says so.
      publish(manual ? { kind: 'error', message } : before)
      return
    }
    if (!release) {
      publish(manual ? { kind: 'up-to-date' } : { kind: 'idle' })
      return
    }
    const skipped = skips.read() === release.version
    const install = await installKind(release)
    const ready = prepared?.version === release.version
    if (lastFailure !== null) {
      // Trying again would fail the same way: the release page instead.
      const error = `The last install failed (${lastFailure}).`
      publish({ kind: 'available', release, install, progress: 0, skipped, error })
      return
    }
    if (release.waiting) {
      // A check the user asks for gives the version its rechecks again.
      const rechecking = !skipped && checkSoon(release.version, manual)
      publish({ kind: 'available', release, install, progress: 0, skipped, rechecking })
      return
    }
    publish({ kind: 'available', release, install, progress: ready ? 1 : 0, skipped })
    if (!skipped && install !== 'manual' && !ready) void download(release, install)
  }

  /** Checks again soon for `version`, whose file isn't up yet, when it has rechecks left; whether it will. */
  const rechecks = new WaitingRechecks(test?.waitingChecks ?? WAITING_CHECKS)
  let waitingTimer: NodeJS.Timeout | null = null
  function checkSoon(version: string, asked: boolean): boolean {
    if (waitingTimer) return true
    if (!rechecks.take(version, asked)) return false
    waitingTimer = setTimeout(() => {
      waitingTimer = null
      void check(false)
    }, waitingCheckMs)
    waitingTimer.unref()
    return true
  }

  async function download(release: Release, kind: 'mac' | 'appimage'): Promise<void> {
    const asset = release.asset!
    downloading = release.version
    prepared = null
    try {
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      const file = join(dir, asset.name)
      const response = await net.fetch(asset.url)
      if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`)
      const hash = createHash('sha256')
      let received = 0
      let shown = 0
      const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
      body.on('data', (chunk: Buffer) => {
        received += chunk.length
        hash.update(chunk)
        if (received > asset.size) body.destroy(new Error('download larger than the release says'))
        const progress = Math.floor((received / asset.size) * 100) / 100
        if (progress > shown && progress < 1) {
          shown = progress
          patch({ progress })
        }
      })
      await pipeline(body, createWriteStream(file))
      if (received !== asset.size) throw new Error('download incomplete')
      if (hash.digest('hex') !== asset.sha256) throw new Error('download damaged (checksum)')
      prepared = { version: release.version, path: await prepare(file, kind) }
      patch({ progress: 1, error: undefined })
    } catch (err) {
      console.error(`update ${release.version} not downloaded: ${String(err)}`)
      const reason = err instanceof Error ? err.message : String(err)
      patch({ progress: 0, error: `The download failed (${reason}).` })
    } finally {
      downloading = null
    }
  }

  /** The app an install moves into place: the zip's `.app` (unquarantined), or the AppImage. */
  async function prepare(file: string, kind: 'mac' | 'appimage'): Promise<string> {
    if (kind === 'appimage') {
      await chmod(file, 0o755)
      return file
    }
    const out = join(dir, 'app')
    await run('ditto', ['-x', '-k', file, out])
    const bundle = (await readdir(out)).find((name) => name.endsWith('.app'))
    if (!bundle) throw new Error('no app in the download')
    // Downloaded by Bikube itself it shouldn't be quarantined; cleared in case a tool marked it.
    await run('xattr', ['-dr', 'com.apple.quarantine', join(out, bundle)]).catch(() => undefined)
    await rm(file, { force: true })
    return join(out, bundle)
  }

  /** Starts the script that swaps the app once this process has ended. */
  function spawnInstall(relaunch: boolean): boolean {
    if (installing || !prepared || !target || state.kind !== 'available') return false
    if (state.release.version !== prepared.version) return false
    installing = true
    const how = !relaunch || test ? 'none' : target.kind === 'mac' ? 'open' : 'exec'
    const { from, to, app: reopen } = installPaths(target.kind, prepared.path, target.path)
    const child = spawn(
      '/bin/sh',
      ['-c', INSTALL_SCRIPT, 'sh', String(process.pid), from, to, how, failedFile, reopen],
      { detached: true, stdio: 'ignore' }
    )
    child.on('error', (err) => console.error(`update install not started: ${String(err)}`))
    child.unref()
    return true
  }

  const fromMainFrame = (event: IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.updateState, (event) => {
    if (!fromMainFrame(event)) throw new Error('update:state rejected: untrusted sender')
    return { state, current }
  })
  ipcMain.handle(IPC.updateRunning, (event) => {
    if (!fromMainFrame(event)) throw new Error('update:running rejected: untrusted sender')
    return runningTerminals()
  })
  /** A check the user asked for, from the menu or Settings: the popup shows its outcome. */
  const askedCheck = (): void => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.updateShow)
    void check(true)
  }
  ipcMain.on(IPC.updateCheck, (event) => {
    if (fromMainFrame(event)) askedCheck()
  })
  ipcMain.on(IPC.updateSkip, (event) => {
    if (!fromMainFrame(event) || state.kind !== 'available') return
    skips.write(state.release.version)
    patch({ skipped: true })
  })
  ipcMain.on(IPC.updateInstall, (event) => {
    if (!fromMainFrame(event) || state.kind !== 'available') return
    const { release, install } = state
    // Its file isn't up yet: nothing to download or link to until a check finds it.
    if (release.waiting) return
    if (install === 'manual' || state.error) {
      void shell.openExternal(release.pageUrl)
      return
    }
    if (prepared?.version === release.version) {
      if (spawnInstall(true)) app.quit()
      return
    }
    // A skipped version the user now wants: fetched first, installed on the next click.
    patch({ skipped: false })
    if (!downloading) void download(release, install)
  })
  ipcMain.on(IPC.updateOpenPage, (event) => {
    if (!fromMainFrame(event) || state.kind !== 'available') return
    void shell.openExternal(state.release.pageUrl)
  })

  return {
    start: () => {
      if (!enabled) return
      void check(false)
      setInterval(() => void check(false), CHECK_INTERVAL_MS).unref()
    },
    check: askedCheck,
    installAtQuit: () => {
      if (state.kind === 'available' && !state.skipped) spawnInstall(false)
    }
  }
}
