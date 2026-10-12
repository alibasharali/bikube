import { ipcMain, type WebContents } from 'electron'
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

  ipcMain.handle(IPC.spawn, (event, cols: number, rows: number) => {
    const { id } = manager.spawn({ cols, rows })
    owners.set(id, event.sender)
    // A closed window must not leave its shells behind.
    event.sender.once('destroyed', () => manager.kill(id))
    return id
  })
  ipcMain.on(IPC.write, (_event, id: string, data: string) => manager.write(id, data))
  ipcMain.on(IPC.resize, (_event, id: string, cols: number, rows: number) =>
    manager.resize(id, cols, rows)
  )
  ipcMain.on(IPC.kill, (_event, id: string) => manager.kill(id))

  return manager
}
