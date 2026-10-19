import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { ScrollbackStore } from '../core/scrollback-store'
import { IPC } from '../shared/api'

/**
 * Cards' kept output (#46 D4) in `<userData>/scrollback`: only the window's own top-level page
 * may read, save or delete, as with `state:*`.
 */
export function registerScrollback(): ScrollbackStore {
  const store = new ScrollbackStore({
    dir: join(app.getPath('userData'), 'scrollback'),
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
      rmSync
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
  return store
}
