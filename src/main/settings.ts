import { app, ipcMain, nativeTheme, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { windowBackground, type AppThemeId } from '../core/app-themes'
import { readGhosttyConfig } from '../core/ghostty-config'
import { SessionManager } from '../core/session-manager'
import { SettingsFile } from '../core/settings-file'
import { shellCandidates } from '../core/shells'
import { type Settings } from '../core/settings'
import { IPC, type ShellChoices } from '../shared/api'

export interface MainSettings {
  /** Sets `nativeTheme.themeSource` from the loaded settings; call once the app is ready. */
  applyTheme(): void
  /**
   * The window background of the app theme's resolved version (#10 D2, #64 D7), so a launch
   * doesn't flash another colour.
   */
  backgroundColor(): string
  /** The App theme setting (#64 D1), which the window's page applies before its first paint. */
  appTheme(): AppThemeId
  flush(): void
  /** The Shell setting: an absolute path, or '' for the login shell. */
  shell(): string
  /** The settings opening a file from the side panel uses (#55 D14, D15). */
  editor(): Pick<Settings, 'editor' | 'editorCommand' | 'shell'>
  /** The Claude Code status updates setting. */
  claudeStatus(): boolean
  /** The Shell integration setting (#45 D4). */
  shellIntegration(): boolean
  /** The Keep output after a card stops setting (#46 D8). */
  keepOutput(): boolean
  /** Calls `listener` each time a settings save turns Keep output off (#46 D8). */
  onKeepOutputOff(listener: () => void): void
  /** The global shortcut's D7 text, undefined when none is set (#51 D9). */
  globalShortcut(): string | undefined
  /** The Open the next waiting card switch (#51 D4). */
  openWaitingOnShow(): boolean
  /** Calls `listener` with the global shortcut after each valid settings save (#51 D8). */
  onGlobalShortcut(listener: (shortcut: string | undefined) => void): void
  /** The sync folder kept in the settings file (#13 D10), or null when sync is off. */
  syncFolder(): string | null
  /** Keeps `folder` (already checked) as the sync folder, or null for off, and writes the file. */
  setSyncFolder(folder: string | null): void
}

/**
 * The settings file in `userData` (#10 D6), read at once so the first window gets its theme.
 * Only a window's own top-level page may load or save; call `flush` before quitting.
 */
export function registerSettings(): MainSettings {
  const dir = app.getPath('userData')
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error(`settings directory not created: ${String(err)}`)
  }
  const file = new SettingsFile({
    dir,
    fs: { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync },
    platform: process.platform
  })
  file.load()

  const applyTheme = (settings: Settings): void => {
    nativeTheme.themeSource = settings.theme
  }

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.settingsLoad, async (event) => {
    if (!fromMainFrame(event)) throw new Error('settings:load rejected: untrusted sender')
    return file.load()
  })
  let keepOutputOff = (): void => {}
  let globalShortcutSaved: (shortcut: string | undefined) => void = () => {}
  ipcMain.on(IPC.settingsSave, (event, settings: unknown) => {
    if (!fromMainFrame(event)) return
    const keptOutput = file.load().keepOutput
    const kept = file.save(settings)
    if (!kept) return
    applyTheme(kept)
    if (keptOutput && !kept.keepOutput) keepOutputOff()
    globalShortcutSaved(kept.globalShortcut)
  })

  ipcMain.handle(IPC.settingsShells, async (event): Promise<ShellChoices> => {
    if (!fromMainFrame(event)) throw new Error('settings:shells rejected: untrusted sender')
    const listed = shellCandidates((await readText('/etc/shells')) ?? '', homedir())
    // The same file through another path (Linux's /bin → /usr/bin) is listed once, first path kept.
    const resolved = await Promise.all(
      listed.map(async (path) =>
        (await isExecutable(path)) ? realpath(path).catch(() => null) : null
      )
    )
    const seen = new Set<string>()
    const shells = listed.filter((_, i) => {
      const real = resolved[i]
      if (!real || seen.has(real)) return false
      seen.add(real)
      return true
    })
    return { login: SessionManager.defaultShell(), shells }
  })
  ipcMain.handle(IPC.settingsGhosttyConfig, async (event) => {
    if (!fromMainFrame(event)) throw new Error('settings:ghosttyConfig rejected: untrusted sender')
    return readGhosttyConfig({
      readFile: readText,
      home: homedir(),
      xdgConfigHome: process.env['XDG_CONFIG_HOME'],
      platform: process.platform
    })
  })

  return {
    shell: () => file.load().shell,
    claudeStatus: () => file.load().claudeStatus,
    shellIntegration: () => file.load().shellIntegration,
    keepOutput: () => file.load().keepOutput,
    onKeepOutputOff: (listener) => {
      keepOutputOff = listener
    },
    globalShortcut: () => file.load().globalShortcut,
    openWaitingOnShow: () => file.load().openWaitingOnShow,
    onGlobalShortcut: (listener) => {
      globalShortcutSaved = listener
    },
    editor: () => {
      const { editor, editorCommand, shell } = file.load()
      return { editor, editorCommand, shell }
    },
    applyTheme: () => applyTheme(file.load()),
    appTheme: () => file.load().appTheme,
    backgroundColor: () =>
      windowBackground(file.load().appTheme, nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    flush: () => file.flush(),
    syncFolder: () => file.syncFolder(),
    setSyncFolder: (folder) => file.setSyncFolder(folder)
  }
}

/** A whole text file, or null when it is missing, unreadable or not a file. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
