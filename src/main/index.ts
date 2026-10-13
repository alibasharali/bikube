import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerClipboard } from './clipboard'
import { registerDirectories } from './directories'
import { registerState } from './state'
import { registerTerminals } from './terminals'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'Drovr',
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

const state = registerState()
const terminals = registerTerminals()
registerClipboard()
registerDirectories()

// The app is one local page: a dropped file or link must never replace it and inherit the bridge.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

// Pending board changes reach the disk, then no PTY process outlives the app.
app.on('before-quit', () => {
  state.flush()
  terminals.killAll()
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS (Cmd+Q quits there).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
