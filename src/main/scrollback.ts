import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { ScrollbackStore } from '../core/scrollback-store'
import type { WorkspaceState } from '../core/workspace-store'
import { IPC } from '../shared/api'

export interface MainScrollback {
  store: ScrollbackStore
  /**
   * Resolves when the window says its quit saves were sent (#46 D2): call it before sending
   * `app:quitting`. Saves arrive in order on the same channel, so they are written by then.
   */
  quitSaved(): Promise<void>
}

/**
 * Cards' kept output (#46 D4) in `<userData>/scrollback`: only the window's own top-level page
 * may read, save or delete, as with `state:*`. Nothing is read or saved while `keeps` (the Keep
 * output setting, D8) reads false.
 */
export function registerScrollback(keeps: () => boolean): MainScrollback {
  const store = new ScrollbackStore({
    dir: join(app.getPath('userData'), 'scrollback'),
    keeps,
    fs: {
      mkdirSync,
      chmodSync,
      openSync,
      writeFileSync,
      fsyncSync,
      closeSync,
      renameSync,
      readFileSync,
      statSync,
      rmSync,
      readdirSync
    }
  })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.scrollbackRead, (event, cardId: unknown) => {
    if (!fromMainFrame(event)) throw new Error('scrollback:read rejected: untrusted sender')
    return store.read(cardId)
  })
  ipcMain.on(IPC.scrollbackSave, (event, cardId: unknown, data: unknown) => {
    if (fromMainFrame(event)) store.save(cardId, data)
  })
  ipcMain.on(IPC.scrollbackDelete, (event, cardId: unknown) => {
    if (fromMainFrame(event)) store.delete(cardId)
  })
  let quitSaved = (): void => {}
  ipcMain.on(IPC.scrollbackQuitSaved, (event) => {
    if (fromMainFrame(event)) quitSaved()
  })
  return {
    store,
    quitSaved: () =>
      new Promise<void>((resolve) => {
        quitSaved = resolve
      })
  }
}

/** The ids of every card on the given boards, whose saves the launch prune keeps (#46 D7). */
export function cardIds(...boards: WorkspaceState[]): string[] {
  return boards.flatMap((board) => board.workspaces.flatMap((w) => w.cards.map((c) => c.id)))
}
