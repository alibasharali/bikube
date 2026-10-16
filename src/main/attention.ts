import { app, BrowserWindow, ipcMain, shell, type IpcMainEvent } from 'electron'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { IPC } from '../shared/api'

const MAX_BADGE = 999

/**
 * What the renderer needs from the desktop: the Dock (or launcher) badge count, bringing the window
 * forward when a notification is clicked, asking for attention (a Dock bounce on macOS, a
 * flashing taskbar entry elsewhere) while the window isn't focused, the home folder, and opening
 * a workspace's folder in the file manager.
 */
export function registerAttention(): void {
  const fromMainFrame = (event: IpcMainEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  const windowOf = (event: IpcMainEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.on(IPC.appSetBadge, (event, count: unknown) => {
    if (!fromMainFrame(event)) return
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return
    app.setBadgeCount(Math.min(count, MAX_BADGE))
  })
  ipcMain.on(IPC.appFocus, (event) => {
    if (!fromMainFrame(event)) return
    const window = windowOf(event)
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  ipcMain.handle(IPC.appHome, () => process.env['DROVR_HOME_DIR'] || homedir())
  ipcMain.on(IPC.appReveal, (event, path: unknown) => {
    if (!fromMainFrame(event) || typeof path !== 'string' || !isAbsolute(path)) return
    void stat(path)
      .then((s) => (s.isDirectory() ? shell.openPath(path) : undefined))
      .catch(() => undefined)
  })
  ipcMain.on(IPC.appRequestAttention, (event) => {
    if (!fromMainFrame(event)) return
    const window = windowOf(event)
    if (!window || window.isFocused()) return
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    else window.flashFrame(true)
  })
}
