import { Menu } from 'electron'

/**
 * macOS keeps Electron's standard application menu, except that its Close Window item has no
 * Cmd+W, so Cmd+W reaches the card view as the Close pane shortcut (#31 D6). Elsewhere the default
 * menu stays as it is (#14 D9).
 */
export function installAppMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
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
