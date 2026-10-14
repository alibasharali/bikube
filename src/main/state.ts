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
  /**
   * Replaces main's state with a board from the sync folder (#13 D7, D11) and writes it like a
   * save; not passed to `onSaved`, since it came from the folder.
   */
  set(state: WorkspaceState): void
  flush(): void
  /**
   * Holds every `state:load` until `ready` settles (the sync folder's bounded launch read, #13 D11,
   * #26 D4), so the window's first board is the synced one when the folder answers in time.
   */
  holdLoad(ready: Promise<unknown>): void
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

  let loadReady: Promise<unknown> = Promise.resolve()
  ipcMain.handle(IPC.stateLoad, async (event) => {
    if (!fromMainFrame(event)) throw new Error('state:load rejected: untrusted sender')
    // A launch read that failed still answers, with the local board.
    await loadReady.catch(() => {})
    return file.load()
  })
  ipcMain.on(IPC.stateSave, (event, state: unknown) => {
    if (fromMainFrame(event) && file.save(state)) onSaved?.(file.load())
  })
  return {
    load: () => file.load(),
    set: (next) => {
      file.save(next)
    },
    flush: () => file.flush(),
    holdLoad: (ready) => {
      loadReady = ready
    }
  }
}
