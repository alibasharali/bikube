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
import { SettingsFile } from '../core/settings-file'
import { THEME_BACKGROUNDS, type Settings } from '../core/settings'
import { IPC } from '../shared/api'

export interface MainSettings {
  /** Sets `nativeTheme.themeSource` from the loaded settings; call once the app is ready. */
  applyTheme(): void
  /** The window background of the resolved theme (#10 D2), so a light launch doesn't flash dark. */
  backgroundColor(): string
  flush(): void
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
    fs: { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync }
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
  ipcMain.on(IPC.settingsSave, (event, settings: unknown) => {
    if (!fromMainFrame(event)) return
    const kept = file.save(settings)
    if (kept) applyTheme(kept)
  })

  return {
    applyTheme: () => applyTheme(file.load()),
    backgroundColor: () => THEME_BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    flush: () => file.flush(),
    syncFolder: () => file.syncFolder(),
    setSyncFolder: (folder) => file.setSyncFolder(folder)
  }
}
