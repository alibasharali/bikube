import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { isSessionId, isValidSize, isWriteData } from '../core/ipc-guards'
import { PageGenerations } from '../core/page-generations'
import { SessionManager } from '../core/session-manager'
import { SessionOwners } from '../core/session-owners'
import { spawnInDirectory } from '../core/terminal-spawn'
import { IPC, type TerminalExit } from '../shared/api'

/** Wires the session manager to IPC. Sessions stream to the window that spawned them. */
export function registerTerminals(): SessionManager {
  const manager = new SessionManager()
  const owners = new SessionOwners<WebContents>()
  const pages = new PageGenerations<WebContents>()

  manager.on('data', (id, data) => {
    const owner = owners.ownerOf(id)
    if (owner && !owner.isDestroyed()) owner.send(IPC.data, id, data)
  })
  manager.on('exit', (id, { exitCode, signal }) => {
    const owner = owners.ownerOf(id)
    owners.remove(id)
    const exit: TerminalExit = { id, exitCode, signal }
    if (owner && !owner.isDestroyed()) owner.send(IPC.exit, exit)
  })

  // Only a window's own top-level page may drive terminals, never a subframe.
  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  // Calls on an existing session must come from the window that spawned it.
  const ownedBy = (event: IpcMainEvent, id: unknown): id is string =>
    fromMainFrame(event) && isSessionId(id) && owners.ownerOf(id) === event.sender

  // Hooked once per window, on its first spawn request: a window's shells end with its page.
  const watch = (owner: WebContents): void => {
    const killAll = (): void => owners.sessionsOf(owner).forEach((id) => manager.kill(id))
    owner.once('destroyed', () => {
      pages.release(owner)
      owners.release(owner).forEach((id) => manager.kill(id))
    })
    // A reload or crash leaves the old page's shells with no UI to drive them; a spawn still
    // checking its directory for the old page must not start one either.
    owner.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      pages.bump(owner)
      killAll()
    })
    owner.on('render-process-gone', () => {
      pages.bump(owner)
      killAll()
    })
  }

  ipcMain.handle(IPC.spawn, async (event, cols: unknown, rows: unknown, cwd: unknown) => {
    if (!fromMainFrame(event)) throw new Error('terminal:spawn rejected: untrusted sender')
    const owner = event.sender
    if (pages.track(owner)) watch(owner)
    const samePage = pages.snapshot(owner)
    // Re-checked after the directory check: no spawn for a page that reloaded or closed meanwhile.
    const result = await spawnInDirectory(
      { cols, rows, cwd },
      (options) => manager.spawn(options),
      {
        stillCurrent: () => samePage() && !owner.isDestroyed()
      }
    )
    if (result.ok) owners.add(owner, result.id)
    return result
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
