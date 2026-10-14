import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { StateFile } from '../core/state-file'
import type { WorkspaceState } from '../core/workspace-store'
import { IPC } from '../shared/api'

export interface MainState {
  /** Main's latest state: the last valid save, else the file's, else an empty board. */
  load(): WorkspaceState
  flush(): void
}

/**
 * The saved-state file in `userData` (#8 D2, D5, D6, D7). Only a window's own top-level page may
 * load or save; call `flush` before quitting. `onSaved` gets every valid save (the sync folder
 * writes the board from them, #13 D4).
 */
export function registerState(onSaved?: (state: WorkspaceState) => void): MainState {
  const dir = app.getPath('userData')
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error(`state directory not created: ${String(err)}`)
  }
  const file = new StateFile({
    dir,
    fs: { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync }
  })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.stateLoad, async (event) => {
    if (!fromMainFrame(event)) throw new Error('state:load rejected: untrusted sender')
    return file.load()
  })
  ipcMain.on(IPC.stateSave, (event, state: unknown) => {
    if (fromMainFrame(event) && file.save(state)) onSaved?.(file.load())
  })
  return { load: () => file.load(), flush: () => file.flush() }
}
