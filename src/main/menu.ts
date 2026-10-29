import { BrowserWindow, Menu } from 'electron'

/**
 * macOS keeps Electron's standard application menu, with Check for Updates… under About, except
 * that its Close Window item has no Cmd+W, so Cmd+W reaches the card view as the Close pane
 * shortcut (#31 D6), and its View menu's Reload has no Cmd+R (and Force Reload is gone), so a
 * shortcut can take them, e.g. Ghostty's `cmd+r` (`keymap.ts`'s fixed shortcuts). Elsewhere the
 * default menu stays as it is (#14 D9); updates are checked from Settings there.
 */
export function installAppMenu(checkForUpdates: () => void): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: checkForUpdates },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'File',
        submenu: [{ label: 'Close Window', click: (_item, window) => window?.close() }]
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', click: () => BrowserWindow.getFocusedWindow()?.webContents.reload() },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}
