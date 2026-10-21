import { clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isClipboardText } from '../core/ipc-guards'
import { IPC } from '../shared/api'

/** Clipboard access for the renderer, limited to a window's own top-level page. */
export function registerClipboard(): void {
  const fromMainFrame = (event: IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.clipboardRead, (event) => {
    if (!fromMainFrame(event)) throw new Error('clipboard:read rejected: untrusted sender')
    const text = clipboard.readText()
    // Never hand back more than a paste may carry.
    return isClipboardText(text) ? text : ''
  })
  ipcMain.handle(IPC.clipboardHasImage, (event) => {
    if (!fromMainFrame(event)) throw new Error('clipboard:hasImage rejected: untrusted sender')
    return !clipboard.readImage().isEmpty()
  })
  ipcMain.handle(IPC.clipboardWrite, (event, text: unknown) => {
    if (!fromMainFrame(event)) throw new Error('clipboard:write rejected: untrusted sender')
    if (!isClipboardText(text)) throw new Error('clipboard:write rejected: invalid text')
    clipboard.writeText(text)
  })
}
