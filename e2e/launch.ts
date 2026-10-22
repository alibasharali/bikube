import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDirs: string[] = []

let zdotdir: string | undefined

/** One empty folder for every launch's `ZDOTDIR`, kept for the whole run. */
function emptyZdotdir(): string {
  zdotdir ??= mkdtempSync(join(tmpdir(), 'bikube-zdotdir-'))
  return zdotdir
}

/** A fresh, empty data directory for one test's saved board (#8 D11); see `removeDataDirs`. */
export function newDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bikube-data-'))
  dataDirs.push(dir)
  return dir
}

/** Deletes every data directory `newDataDir` made; call after the test's apps are closed. */
export function removeDataDirs(): void {
  for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export interface LaunchOptions {
  /** Where the app keeps its saved board; a fresh one when omitted. Reuse it to restart. */
  dataDir?: string
  /** The environment to launch with; defaults to this process's. */
  env?: Record<string, string>
  /** Extra Electron arguments after `--no-sandbox` (and the dev build's `.` before it). */
  args?: string[]
  /**
   * A packaged app's executable (e.g. `dist/linux-unpacked/bikube`) to launch instead of the dev
   * build; it loads its own bundled app, so no `.` is passed.
   */
  executablePath?: string
  /** Called with the main process's stderr from the start (of the launch kept, after a retry). */
  onStderr?: (chunk: string) => void
}

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
}

/**
 * How long one launch may take to bring its window and the app's root (#23 D2): two attempts fit
 * in the 60 s test timeout. `BIKUBE_E2E_WINDOW_TIMEOUT_MS` overrides it (a number above 0).
 */
const WINDOW_TIMEOUT_MS = ((): number => {
  const ms = Number(process.env['BIKUBE_E2E_WINDOW_TIMEOUT_MS'])
  return Number.isFinite(ms) && ms > 0 ? ms : 25_000
})()

/**
 * Launches the built app (or the packaged executable given as `executablePath`) with its own data
 * directory (`BIKUBE_USER_DATA_DIR`, #8 D11), so no test shares or touches a real board, and
 * waits for its window. `--no-sandbox`: CI and containers have no setuid chrome-sandbox.
 * A launch that brings no window is logged with its stderr, killed and tried once more (#23 D2).
 */
export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const dataDir = options.dataDir ?? newDataDir()
  try {
    return await launchOnce(options, dataDir)
  } catch (first) {
    console.warn(`launchApp: no window, launching again: ${String(first)}`)
    // The retry gets its own time on top of the test's; a test with no timeout (0) keeps none.
    const timeout = test.info().timeout
    if (timeout > 0) test.info().setTimeout(timeout + WINDOW_TIMEOUT_MS)
    try {
      return await launchOnce(options, dataDir)
    } catch (second) {
      throw new Error(`launchApp: no window twice:\n${String(first)}\n${String(second)}`, {
        cause: second
      })
    }
  }
}

async function launchOnce(options: LaunchOptions, dataDir: string): Promise<Launched> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) base[key] = value
  }
  const deadline = Date.now() + WINDOW_TIMEOUT_MS
  const app = await electron.launch({
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    args: [...(options.executablePath ? [] : ['.']), '--no-sandbox', ...(options.args ?? [])],
    env: {
      ...base,
      BIKUBE_USER_DATA_DIR: dataDir,
      // zsh reads its user files from here: an empty folder, so a developer's ~/.zshrc (prompts,
      // fastfetch…) never slows or fills the test terminals. bash and sh ignore it.
      ZDOTDIR: emptyZdotdir(),
      // On macOS the window stays hidden so a run doesn't take over the screen;
      // BIKUBE_E2E_SHOW=1 shows it again. Linux runs under xvfb, so nothing changes there.
      ...(process.platform === 'darwin' &&
        base['BIKUBE_E2E_SHOW'] !== '1' && { BIKUBE_E2E_HIDDEN: '1' })
    },
    timeout: WINDOW_TIMEOUT_MS
  })
  // `onStderr` hears only the launch that is kept: what came before the window is replayed then.
  let stderr = ''
  let onStderr: ((chunk: string) => void) | undefined
  app.process().stderr?.on('data', (chunk: Buffer) => {
    if (onStderr) onStderr(chunk.toString())
    else stderr += chunk.toString()
  })
  try {
    const page = await app.firstWindow({ timeout: Math.max(1, deadline - Date.now()) })
    await page.waitForSelector('[data-testid=app]', { timeout: Math.max(1, deadline - Date.now()) })
    if (options.onStderr) {
      onStderr = options.onStderr
      if (stderr) onStderr(stderr)
    }
    return { app, page, dataDir }
  } catch (error) {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${reason}\n--- stderr ---\n${stderr}`, { cause: error })
  }
}
