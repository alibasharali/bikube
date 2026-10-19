import { app, globalShortcut, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { GlobalShortcut, globalPressAction, withFeature } from '../core/global-shortcut'
import { IPC } from '../shared/api'
import { appWindow } from './card-windows'
import type { MainSettings } from './settings'

/** Chromium's feature that lets a Wayland desktop with the portal grant global shortcuts (#51 D8). */
const PORTAL_FEATURE = 'GlobalShortcutsPortal'

/**
 * On Linux, adds the portal feature to any `enable-features` already set (#51 D8). Call before
 * the app is ready.
 */
export function enableGlobalShortcutsPortal(): void {
  if (process.platform !== 'linux') return
  const features = app.commandLine.getSwitchValue('enable-features')
  app.commandLine.appendSwitch('enable-features', withFeature(features, PORTAL_FEATURE))
}

/** Where the development build puts main's press handler for the smoke tests (AC4). */
const TEST_HOOK = '__drovrGlobalShortcutPress'

/**
 * The global shortcut (#51): registered at once from the saved settings and again after each save
 * that changes it (D8), unregistered while a shortcut field records (D6: until it ends, the window loses focus or
 * its page is gone) and at quit (D10). A
 * press hides the focused window or brings it forward (D3), and then, with Open the next waiting
 * card on, tells the renderer (`app:globalShow`, D4). A window created by a press gets no message:
 * its page isn't loaded yet. Call once the app is ready; `createWindow` makes the window when
 * there is none.
 */
export function registerGlobalShortcut(settings: MainSettings, createWindow: () => void): void {
  const press = (): void => {
    // The main window, never a card window (#53 D3).
    const window = appWindow()
    const look = window
      ? {
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused()
        }
      : null
    const action = globalPressAction(look, process.platform)
    if (action === 'create' || !window) {
      createWindow()
      return
    }
    if (action === 'hide') {
      app.hide()
      return
    }
    if (action === 'minimize') {
      window.minimize()
      return
    }
    // As `second-instance` does; on macOS the app must also take the front from the other app.
    if (window.isMinimized()) window.restore()
    window.show()
    if (process.platform === 'darwin') app.focus({ steal: true })
    window.focus()
    if (settings.openWaitingOnShow() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC.appGlobalShow)
    }
  }

  const shortcut = new GlobalShortcut(
    {
      register: (accelerator, onPress) => globalShortcut.register(accelerator, onPress),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    process.platform,
    press
  )
  shortcut.set(settings.globalShortcut())
  settings.onGlobalShortcut((text) => shortcut.set(text))
  app.on('will-quit', () => {
    shortcut.dispose()
    globalShortcut.unregisterAll()
  })

  // The smoke tests can't press an OS-wide key under xvfb: the development build hands them main's
  // handler instead (AC4).
  if (!app.isPackaged) Object.assign(globalThis, { [TEST_HOOK]: press })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.globalShortcutState, (event) => {
    if (!fromMainFrame(event)) throw new Error('globalShortcut:state rejected: untrusted sender')
    return shortcut.state()
  })
  ipcMain.on(IPC.globalShortcutSuspend, (event, suspended: unknown) => {
    if (!fromMainFrame(event) || typeof suspended !== 'boolean') return
    if (suspended) shortcut.suspend()
    else shortcut.resume()
  })
  // Recording ends when the window loses focus (D6), even if the page never says so.
  app.on('browser-window-blur', () => shortcut.resume())
  // And when the page that recorded is gone: a reload, a committed main-frame navigation (one the
  // navigation lock cancels never commits) or a crash (D6).
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('did-navigate', () => shortcut.resume())
    window.webContents.on('render-process-gone', () => shortcut.resume())
  })
}
