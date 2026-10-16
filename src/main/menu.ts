import { Menu } from 'electron'

/**
 * macOS keeps Electron's standard application menu, with Check for Updates… under About, except
 * that its Close Window item has no Cmd+W, so Cmd+W reaches the card view as the Close pane
 * shortcut (#31 D6). Elsewhere the default menu stays as it is (#14 D9); updates are checked from
 * Settings there.
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
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}
