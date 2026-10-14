import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { KILL_GRACE_MS } from '../core/session-manager'
import { boardShellEnvFor, boardSocketPath, registerBoard } from './board'
import { registerClipboard } from './clipboard'
import { registerDirectories } from './directories'
import { registerSettings, type MainSettings } from './settings'
import { registerState } from './state'
import { registerSync } from './sync'
import { registerTerminals } from './terminals'

/** The longest a quit waits for the shells to exit (#18 D2): the kill's grace period + 1 s. */
const QUIT_WAIT_MS = KILL_GRACE_MS + 1_000

function createWindow(settings: MainSettings): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'Drovr',
    // The resolved theme's background (#10 D2), so a light launch doesn't flash dark.
    backgroundColor: settings.backgroundColor(),
    // Off macOS the default menu bar stays hidden until Alt is pressed; its accelerators still
    // work (#14 D9). macOS keeps its app menu.
    autoHideMenuBar: process.platform !== 'darwin',
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
  // Every valid save reaches the sync folder (#13 D4); saves only come once the window is up.
  const state = registerState((saved) => sync.noteBoard(saved))
  // Read before the window exists, so it opens in the saved theme (#10 D6).
  const settings = registerSettings()
  // The sync folder from the settings, read before the window asks for its status (#13 D13).
  const sync = registerSync(state, settings)
  const socketPath = boardSocketPath()
  const terminals = registerTerminals(boardShellEnvFor(socketPath))
  registerClipboard()
  registerDirectories()

  // The app is one local page: a dropped file or link must never replace it and inherit the bridge.
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  // Pending board, settings and sync folder changes reach the disk, then no PTY process outlives
  // the app (#18 D2): the first quit with live shells is held until they have exited (SIGHUP, then
  // SIGKILL, #18 D1) or `QUIT_WAIT_MS` passed; any later quit SIGKILLs what is left and goes through.
  let holding = false
  app.on('before-quit', (event) => {
    if (holding) {
      terminals.forceKillAll()
      return
    }
    state.flush()
    settings.flush()
    sync.flush()
    if (terminals.sessionCount === 0) return
    holding = true
    event.preventDefault()
    const waited = new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS))
    void Promise.race([terminals.killAll(), waited]).then(() => app.quit())
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
