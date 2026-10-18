import { ipcMain, shell } from 'electron'
import { openableUrl } from '../core/terminal-links'
import { IPC } from '../shared/api'

/** Opens a terminal link in the default browser, for a window's own top-level page only. */
export function registerLinks(): void {
  ipcMain.on(IPC.linkOpen, (event, text: unknown) => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return
    const url = openableUrl(text)
    if (url) void shell.openExternal(url)
  })
}
