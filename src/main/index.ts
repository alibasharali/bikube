import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { boundedWait } from '../core/bounded-wait'
import { killAtQuit, quitHold } from '../core/quit-hold'
import { longCommandMsArg } from '../core/long-commands'
import { hostNameArg } from '../core/shell-marks'
import { KILL_GRACE_MS } from '../core/session-manager'
import { IPC } from '../shared/api'
import { boardShellEnvFor, boardSocketPath, registerBoard, sshBoardSockets } from './board'
import { registerAttention } from './attention'
import { allowCardWindows, appWindow, registerCardWindows } from './card-windows'
import { registerClipboard } from './clipboard'
import { moveOldData } from './data-migration'
import { registerDirectories } from './directories'
import { registerFiles } from './files'
import { registerAgents } from './agents'
import { enableGlobalShortcutsPortal, registerGlobalShortcut } from './global-shortcut'
import { registerGit } from './git'
import { registerLinks } from './links'
import { registerPorts } from './ports'
import { installAppMenu } from './menu'
import { registerSettings, type MainSettings } from './settings'
import { cardIds, registerScrollback } from './scrollback'
import { registerState } from './state'
import { registerSync } from './sync'
import { registerTerminals } from './terminals'
import { registerUpdates } from './updates'
import { registerWorktrees } from './worktrees'

/**
 * The longest one quit hold waits for the shells to exit (#18 D2) and the sync folder's flush
 * (#26 D5): the kill's grace period + 1 s.
 */
const QUIT_WAIT_MS = KILL_GRACE_MS + 1_000

/** The longest a quit waits for the window's quit saves before stopping the shells (#46 D2). */
const QUIT_SAVE_WAIT_MS = 1_000

/**
 * Smoke tests on macOS run with the window never shown and no Dock icon (`BIKUBE_E2E_HIDDEN=1`, set
 * by `e2e/launch.ts`), so a run doesn't take over the screen; Chromium's throttling of hidden
 * windows is off then, so timers and drawing run as in a shown one. Only the development build
 * the tests launch honours it: a packaged app always shows its window.
 */
const hiddenForTests = !app.isPackaged && process.env['BIKUBE_E2E_HIDDEN'] === '1'

/**
 * The tests' shortened threshold for long command notifications (#45 D7), `BIKUBE_LONG_COMMAND_MS`,
 * passed to the renderer as an argument; only the development build honours it.
 */
const longCommandMs = app.isPackaged ? undefined : process.env['BIKUBE_LONG_COMMAND_MS']

/** The app icon for the development build, which has no bundle of its own (Linux reads it per window). */
const devIcon = join(app.getAppPath(), 'build', 'icon.png')

function createWindow(settings: MainSettings): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'Bikube',
    // The resolved theme's background (#10 D2), so a light launch doesn't flash dark.
    backgroundColor: settings.backgroundColor(),
    ...(!app.isPackaged && process.platform === 'linux' && { icon: devIcon }),
    // Off macOS the default menu bar stays hidden until Alt is pressed; its accelerators still
    // work (#14 D9). macOS keeps its app menu.
    autoHideMenuBar: process.platform !== 'darwin',
    // On macOS Bikube draws its own title bar, with the window buttons inset over the sidebar.
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 13 }
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(hiddenForTests && { backgroundThrottling: false }),
      // This machine's host name, which the sandboxed renderer can't read (#45 D8).
      additionalArguments: [
        hostNameArg(hostname()),
        ...(longCommandMs ? [longCommandMsArg(longCommandMs)] : [])
      ]
    }
  })

  // Its page opens its cards' own windows, and they close with it (#53 D3).
  allowCardWindows(mainWindow, () => settings.backgroundColor(), hiddenForTests)

  mainWindow.on('ready-to-show', () => {
    if (!hiddenForTests) mainWindow.show()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Smoke tests give each launch its own data directory (#8 D11); the development build otherwise
// uses `bikube-dev`, so it runs beside an installed Bikube. Must be set before ready.
const userDataDir =
  process.env['BIKUBE_USER_DATA_DIR'] ??
  (app.isPackaged ? undefined : join(app.getPath('appData'), 'bikube-dev'))
if (userDataDir) app.setPath('userData', userDataDir)
// Drovr's data, once, before anything reads or locks the folder.
const dataReady = moveOldData()

// A Wayland desktop with the portal can grant the global shortcut (#51 D8); set before ready.
enableGlobalShortcutsPortal()

// One instance per data directory (#8 D12): a second launch hands over to the running one and
// exits before it loads or saves anything.
if (!dataReady) {
  // Exits before ready, so the new data folder is never created without Drovr's in it.
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
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
  // The window's first board waits for the launch read, bounded (#13 D11, #26 D4).
  state.holdLoad(sync.launched)
  const socketPath = boardSocketPath()
  // Each SSH session's own `board` socket (#25 D2), relaying once `registerBoard` runs.
  const sshBoard = sshBoardSockets(socketPath)
  const terminals = registerTerminals(
    boardShellEnvFor(socketPath),
    sshBoard.sockets,
    () => settings.shell(),
    () => settings.claudeStatus(),
    () => settings.shellIntegration()
  )
  const scrollback = registerScrollback(() => settings.keepOutput())
  // Saves of cards on neither the local board nor the one after the launch read go (#46 D7), and
  // every save goes while Keep output is off, or when it is turned off (D8).
  const localBoard = state.load()
  void sync.launched.then(() =>
    settings.keepOutput()
      ? scrollback.store.prune(cardIds(localBoard, state.load()))
      : scrollback.store.clear()
  )
  settings.onKeepOutputOff(() => scrollback.store.clear())
  registerClipboard()
  registerLinks()
  registerPorts()
  registerDirectories()
  registerAttention()
  registerCardWindows(hiddenForTests)
  registerWorktrees()
  registerGit(() => settings.shell())
  registerFiles(() => settings.editor())
  registerAgents(() => settings.shell())
  const updates = registerUpdates(() => terminals.sessionCount)

  // The app is one local page: a dropped file or link must never replace it and inherit the bridge.
  // `about:blank` never fires `will-navigate`; the preload cancels it (#20).
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  // Pending board, settings and sync folder changes reach the disk, then no PTY process outlives
  // the app (#18 D2): the first quit with live shells or a busy sync folder is held until the
  // shells have exited (SIGHUP, then SIGKILL, #18 D1) and the sync folder's flush is done, or
  // `QUIT_WAIT_MS` passed (#26 D5). Any later quit flushes again (the window stays live during the
  // hold, so changes can still come in) and SIGKILLs what is left; the second is held once more,
  // at most `QUIT_WAIT_MS`, while the sync folder is still busy, and a third goes through.
  let holds = 0
  /** Whether the sync folder was busy when the quit that went through began (before its flush). */
  let busyAtLastQuit = false
  app.on('before-quit', (event) => {
    // Told before any shell is stopped, so no card moves on its stop at quit (#42 D4) and every
    // running card's output is saved first (#46 D2).
    const quitSaved = scrollback.quitSaved()
    let told = false
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) continue
      window.webContents.send(IPC.appQuitting)
      told = true
    }
    state.flush()
    settings.flush()
    const syncBusy = sync.busy()
    const synced = sync.flush()
    if (holds > 0) terminals.forceKillAll()
    const hold = quitHold({ holds, liveShells: terminals.sessionCount > 0, syncBusy })
    busyAtLastQuit = syncBusy
    if (!hold.hold) return
    holds++
    event.preventDefault()
    const saved = told ? boundedWait(quitSaved, QUIT_SAVE_WAIT_MS) : Promise.resolve()
    const done = hold.shells ? Promise.all([saved.then(() => terminals.killAll()), synced]) : synced
    void boundedWait(done, QUIT_WAIT_MS).then(() => app.quit())
  })

  // Electron emits `quit` after `will-quit` (which closes the `board` sockets). A sync folder still
  // busy here may have a libuv worker blocked in a stalled fs call, which would keep the process
  // (and its single-instance lock) alive forever: main's state and settings are already flushed
  // and every shell killed, so it ends itself (#26 D5). Busy counts only what was queued before
  // that quit's own flush, which does no fs call when nothing was pending.
  app.on('quit', () => {
    // A downloaded update goes in once this process ends; started before any SIGKILL below.
    updates.installAtQuit()
    const syncBusy = busyAtLastQuit && sync.busy()
    if (!killAtQuit({ syncBusy, platform: process.platform })) return
    console.error('sync folder still busy at quit; ending the process')
    process.kill(process.pid, 'SIGKILL')
  })

  // Another launch on the same data directory: bring this one's window forward instead, the main
  // window, never a card window (#53 D3).
  app.on('second-instance', () => {
    if (!app.isReady()) return
    const window = appWindow()
    if (!window) {
      createWindow(settings)
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  app.whenReady().then(() => {
    // `board` requests from cards (#9 D5, #25 D2): the sockets are gone again once the app quits.
    const closeBoard = registerBoard(socketPath, terminals, sshBoard)
    app.on('will-quit', closeBoard)
    settings.applyTheme()
    // The saved global shortcut, registered before the window opens (#51 D8).
    registerGlobalShortcut(settings, () => createWindow(settings))
    installAppMenu(() => updates.check())
    if (hiddenForTests) app.dock?.hide()
    // Packaged apps carry the icon in their bundle; the development build shows Electron's otherwise.
    else if (!app.isPackaged) app.dock?.setIcon(devIcon)
    createWindow(settings)
    updates.start()
    app.on('activate', () => {
      if (!appWindow()) createWindow(settings)
    })
  })

  // Quit when all windows are closed, except on macOS (Cmd+Q quits there).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
