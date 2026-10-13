import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isDirectory } from '../core/directories'
import { IPC } from '../shared/api'

/** Directory checks and the native folder picker for the renderer, limited to a window's own top-level page. */
export function registerDirectories(): void {
  const fromMainFrame = (event: IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.fsIsDirectory, async (event, path: unknown) => {
    if (!fromMainFrame(event)) throw new Error('fs:isDirectory rejected: untrusted sender')
    return isDirectory(path)
  })
  ipcMain.handle(IPC.dialogPickDirectory, async (event) => {
    if (!fromMainFrame(event)) throw new Error('dialog:pickDirectory rejected: untrusted sender')
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
