import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'node:fs'
import { homedir } from 'node:os'
import { isDirectory, isPathArg } from '../core/directories'
import { applySyncBoard } from '../core/sync-apply'
import { SyncFolder } from '../core/sync-folder'
import type { SyncStatus } from '../core/sync-status'
import { withBoard, type Workspace, type WorkspaceState } from '../core/workspace-store'
import { IPC, type SyncFolderResult } from '../shared/api'
import type { MainSettings } from './settings'
import type { MainState } from './state'

export interface MainSync {
  /** A valid `state:save`: written to the sync file when its board changed (#13 D4). */
  noteBoard(state: WorkspaceState): void
  /** Writes a pending board now and stops watching the folder (before quit). */
  flush(): void
}

/** Folder events come in bursts (a temp file, then a rename): read once they settle. */
const WATCH_SETTLE_MS = 100

/**
 * While the folder is unavailable (#13 D12) it can't be watched, so main checks for it this often
 * (one read of the file) to notice it coming back, and the watch is set up again then.
 */
const UNAVAILABLE_RETRY_MS = 2000

/**
 * The sync folder (#13 D1, D4, D9, D10, D11, D13, D14): reads the folder from the settings at once
 * and applies its board to main's state before any window asks for it (so the window opens on the
 * synced board), reads it again whenever the folder changes or a window gains focus, writes the
 * board from every save, and serves the `sync:*` channels to a window's own top-level page only.
 */
export function registerSync(state: MainState, settings: MainSettings): MainSync {
  // D15: a test can give each instance its own home, which D5 maps to `~`.
  const home = process.env['DROVR_HOME_DIR'] || homedir()
  const sync = new SyncFolder({
    fs: { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, statSync },
    home,
    onStatus: (status) => {
      followStatus(status.kind)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC.syncStatusChanged, status)
      }
    }
  })
  /**
   * A board read from the folder (D7): main's state takes it at once with no card running (what a
   * window not yet listening loads), and every window gets it to apply keeping its running cards
   * (D8), saving the result as any change.
   */
  const apply = (incoming: Workspace[]): void => {
    const local = state.load()
    state.set(
      withBoard(
        local,
        applySyncBoard(incoming, local.workspaces, () => false)
      )
    )
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.syncBoard, incoming)
    }
  }

  // D11: the folder's contents are watched (sync tools replace the file by renaming it).
  let watcher: FSWatcher | null = null
  let settle: ReturnType<typeof setTimeout> | null = null
  const readNow = (): void => {
    const incoming = sync.read()
    if (incoming !== null) apply(incoming)
  }
  const unwatch = (): void => {
    watcher?.close()
    watcher = null
    if (settle !== null) clearTimeout(settle)
    settle = null
  }
  const watchFolder = (folder: string | null): void => {
    unwatch()
    if (folder === null) return
    try {
      const w = watch(folder, () => {
        if (settle !== null) clearTimeout(settle)
        settle = setTimeout(() => {
          settle = null
          readNow()
        }, WATCH_SETTLE_MS)
      })
      w.on('error', (err) => {
        console.error(`sync folder not watched: ${String(err)}`)
        if (watcher === w) unwatch()
      })
      watcher = w
    } catch (err) {
      console.error(`sync folder not watched: ${String(err)}`)
    }
  }

  /**
   * D12: while the folder is unavailable its watch is dropped (a removed folder's watch is dead)
   * and the folder is retried every `UNAVAILABLE_RETRY_MS`; once it is back it is watched again.
   */
  let retry: ReturnType<typeof setInterval> | null = null
  const stopRetry = (): void => {
    if (retry !== null) clearInterval(retry)
    retry = null
  }
  const followStatus = (kind: SyncStatus['kind']): void => {
    if (kind === 'unavailable') {
      unwatch()
      if (retry === null) retry = setInterval(readNow, UNAVAILABLE_RETRY_MS)
      return
    }
    stopRetry()
    if (kind !== 'off' && watcher === null) watchFolder(sync.folderPath())
  }

  const launched = sync.start(settings.syncFolder(), state.load())
  if (launched !== null) apply(launched)
  watchFolder(sync.folderPath())
  app.on('browser-window-focus', readNow)

  const fromMainFrame = (event: IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  /** Keeps `folder` in the settings and joins the boards, handing a joined board to `sender`. */
  const applyFolder = (folder: string | null, sender: WebContents): void => {
    settings.setSyncFolder(folder)
    const joined = sync.setFolder(folder, state.load())
    watchFolder(sync.folderPath())
    if (joined !== null) sender.send(IPC.syncBoard, joined)
  }

  const setFolder = async (path: unknown, sender: WebContents): Promise<SyncFolderResult> => {
    if (path === null) {
      applyFolder(null, sender)
      return { ok: true }
    }
    if (!isPathArg(path) || !(await isDirectory(path))) return { ok: false, reason: 'not found' }
    applyFolder(path, sender)
    return { ok: true }
  }

  ipcMain.handle(IPC.syncStatus, async (event) => {
    if (!fromMainFrame(event)) throw new Error('sync:status rejected: untrusted sender')
    return sync.status()
  })
  ipcMain.handle(IPC.syncSetFolder, async (event, path: unknown) => {
    if (!fromMainFrame(event)) throw new Error('sync:setFolder rejected: untrusted sender')
    return setFolder(path, event.sender)
  })
  ipcMain.handle(IPC.syncPickFolder, async (event) => {
    if (!fromMainFrame(event)) throw new Error('sync:pickFolder rejected: untrusted sender')
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: true }
    return setFolder(result.filePaths[0], event.sender)
  })

  return {
    noteBoard: (next) => sync.noteBoard(next),
    flush: () => {
      sync.flush()
      stopRetry()
      unwatch()
    }
  }
}
