import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { boardShellEnvFor, boardSocketPath, registerBoard } from './board'
import { registerClipboard } from './clipboard'
import { registerDirectories } from './directories'
import { registerSettings, type MainSettings } from './settings'
import { registerState } from './state'
import { registerTerminals } from './terminals'

function createWindow(settings: MainSettings): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'Drovr',
    // The resolved theme's background (#10 D2), so a light launch doesn't flash dark.
    backgroundColor: settings.backgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Smoke tests give each launch its own data directory (#8 D11); must be set before ready.
const userDataDir = process.env['DROVR_USER_DATA_DIR']
if (userDataDir) app.setPath('userData', userDataDir)

// One instance per data directory (#8 D12): a second launch hands over to the running one and
// exits before it loads or saves anything.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  startApp()
}

function startApp(): void {
  const state = registerState()
  // Read before the window exists, so it opens in the saved theme (#10 D6).
  const settings = registerSettings()
  const socketPath = boardSocketPath()
  const terminals = registerTerminals(boardShellEnvFor(socketPath))
  registerClipboard()
  registerDirectories()

  // The app is one local page: a dropped file or link must never replace it and inherit the bridge.
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  // Pending board and settings changes reach the disk, then no PTY process outlives the app.
  app.on('before-quit', () => {
    state.flush()
    settings.flush()
    terminals.killAll()
  })

  // Another launch on the same data directory: bring this one's window forward instead.
  app.on('second-instance', () => {
    if (!app.isReady()) return
    const [window] = BrowserWindow.getAllWindows()
    if (!window) {
      createWindow(settings)
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  app.whenReady().then(() => {
    // `board` requests from cards (#9 D5): the socket is gone again once the app quits.
    const closeBoard = registerBoard(socketPath, terminals)
    app.on('will-quit', closeBoard)
    settings.applyTheme()
    createWindow(settings)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings)
    })
  })

  // Quit when all windows are closed, except on macOS (Cmd+Q quits there).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
