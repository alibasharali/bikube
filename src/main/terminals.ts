import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { isSessionId, isValidSize, isWriteData } from '../core/ipc-guards'
import { SessionManager } from '../core/session-manager'
import { IPC, type TerminalExit } from '../shared/api'

/** Wires the session manager to IPC. Sessions stream to the window that spawned them. */
export function registerTerminals(): SessionManager {
  const manager = new SessionManager()
  const owners = new Map<string, WebContents>()

  manager.on('data', (id, data) => {
    const owner = owners.get(id)
    if (owner && !owner.isDestroyed()) owner.send(IPC.data, id, data)
  })
  manager.on('exit', (id, { exitCode, signal }) => {
    const owner = owners.get(id)
    owners.delete(id)
    const exit: TerminalExit = { id, exitCode, signal }
    if (owner && !owner.isDestroyed()) owner.send(IPC.exit, exit)
  })

  // Only a window's own top-level page may drive terminals, never a subframe.
  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  // Calls on an existing session must come from the window that spawned it.
  const ownedBy = (event: IpcMainEvent, id: unknown): id is string =>
    fromMainFrame(event) && isSessionId(id) && owners.get(id) === event.sender

  ipcMain.handle(IPC.spawn, (event, cols: unknown, rows: unknown) => {
    if (!fromMainFrame(event)) throw new Error('terminal:spawn rejected: untrusted sender')
    if (!isValidSize(cols, rows)) throw new Error('terminal:spawn rejected: invalid size')
    const { id } = manager.spawn({ cols: cols as number, rows: rows as number })
    owners.set(id, event.sender)
    // A closed window must not leave its shells behind.
    event.sender.once('destroyed', () => manager.kill(id))
    return id
  })
  ipcMain.on(IPC.write, (event, id: unknown, data: unknown) => {
    if (ownedBy(event, id) && isWriteData(data)) manager.write(id, data)
  })
  ipcMain.on(IPC.resize, (event, id: unknown, cols: unknown, rows: unknown) => {
    if (ownedBy(event, id) && isValidSize(cols, rows)) {
      manager.resize(id, cols as number, rows as number)
    }
  })
  ipcMain.on(IPC.kill, (event, id: unknown) => {
    if (ownedBy(event, id)) manager.kill(id)
  })

  return manager
}
