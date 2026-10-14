import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isDirectory, isPathArg } from '../core/directories'
import { SyncFolder } from '../core/sync-folder'
import type { WorkspaceState } from '../core/workspace-store'
import { IPC, type SyncFolderResult } from '../shared/api'
import type { MainSettings } from './settings'
import type { MainState } from './state'

export interface MainSync {
  /** A valid `state:save`: written to the sync file when its board changed (#13 D4). */
  noteBoard(state: WorkspaceState): void
  /** Writes a pending board now (before quit). */
  flush(): void
}

/**
 * The sync folder (#13 D1, D4, D9, D10, D13, D14): reads the folder from the settings at once (so
 * the status is known before the window asks), writes the board from every save, and serves the
 * `sync:*` channels to a window's own top-level page only.
 */
export function registerSync(state: MainState, settings: MainSettings): MainSync {
  // D15: a test can give each instance its own home, which D5 maps to `~`.
  const home = process.env['DROVR_HOME_DIR'] || homedir()
  const sync = new SyncFolder({
    fs: { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync },
    home,
    onStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC.syncStatusChanged, status)
      }
    }
  })
  sync.start(settings.syncFolder(), state.load())

  const fromMainFrame = (event: IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  /** Keeps `folder` in the settings and joins the boards, handing a joined board to `sender`. */
  const applyFolder = (folder: string | null, sender: WebContents): void => {
    settings.setSyncFolder(folder)
    const joined = sync.setFolder(folder, state.load())
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
    flush: () => sync.flush()
  }
}
