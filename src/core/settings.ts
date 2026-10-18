/**
 * App-wide settings (#10 D1) and their file format (D6, D7). Plain TS with no Electron or Node
 * imports, so main and the renderer can both use it. The file holds
 * `{ "version": 1, "settings": { "theme", "fontSize", "fontFamily", "shell", "terminalThemeDark",
 * "terminalThemeLight", "useGhosttyTheme", "shortcuts"?, "syncFolder"? } }`; a file from before
 * the shell and terminal theme fields gets their defaults.
 *
 * `shortcuts` (#31 D9) holds only the shortcuts that differ from this OS's default (absent when
 * none do), so reading and checking it needs the platform the app runs on.
 *
 * `syncFolder` (#13 D10) is kept per machine in the same file but is not part of `Settings`:
 * `settings:save` never carries or changes it, only the sync channels do. It is written only while
 * sync is on; absent (or invalid) means off.
 *
 * `fontFamily` is always the family in effect: a typed family is trimmed, and an empty one
 * becomes the default (D4), so the file and every reader see the actual family.
 */

import { readShortcuts, validateShortcuts, type ShortcutOverrides } from './keymap'
import { DROVR_DARK, DROVR_LIGHT, isTerminalThemeName } from './terminal-themes'

export const SETTINGS_FILE_NAME = 'drovr-settings.json'
export const SETTINGS_VERSION = 1

export const THEMES = ['system', 'dark', 'light'] as const
export type Theme = (typeof THEMES)[number]
/** The theme a window shows once `system` is resolved against the OS appearance. */
export type ResolvedTheme = 'dark' | 'light'

export interface Settings extends Preferences {
  theme: Theme
  fontSize: number
  fontFamily: string
  /** The shell every local card starts: an absolute path, or '' for the login shell (`$SHELL`). */
  shell: string
  /** The terminal colour theme under the dark app theme, and under the light one. */
  terminalThemeDark: string
  terminalThemeLight: string
  /** Use the colours of the user's Ghostty config instead of the two themes above. */
  useGhosttyTheme: boolean
  /** The shortcuts that differ from this OS's default (#31 D9); absent when none do. */
  shortcuts?: ShortcutOverrides
}

export const CURSOR_STYLES = ['block', 'bar', 'underline'] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]
export const BELLS = ['none', 'flash', 'sound'] as const
export type Bell = (typeof BELLS)[number]
export const SCROLLBACK_CHOICES = [1000, 5000, 10000, 50000] as const
export const MIN_LINE_HEIGHT = 1
export const MAX_LINE_HEIGHT = 2
export const MAX_LETTER_SPACING = 4
export const MIN_SIDE_PANEL_WIDTH = 200
export const MAX_SIDE_PANEL_WIDTH = 4000

/**
 * The terminal, notification and side panel preferences. Each is written to the file only when it differs
 * from its default, and a missing one reads as its default, so older files load unchanged.
 */
export interface Preferences {
  cursorStyle: CursorStyle
  cursorBlink: boolean
  /** Lines each terminal keeps above the screen. */
  scrollback: number
  /** macOS: Option sends Meta (Esc-prefixed keys) instead of typing special characters. */
  optionAsMeta: boolean
  /** Selecting text copies it. */
  copyOnSelect: boolean
  /** A multiple of the font size, 1 to 2 in steps of 0.1. */
  lineHeight: number
  /** Extra pixels between characters, 0 to 4. */
  letterSpacing: number
  bell: Bell
  /** Bold text in the bright ANSI colours, as most terminals do. */
  boldBright: boolean
  /** A notification when an agent waits for the user or asks a question. */
  notifications: boolean
  notificationSound: boolean
  /** Claude Code cards keep their one-line status with `board status` (#31 D16). */
  claudeStatus: boolean
  /** The side panel beside an open card or shell shows (#55 D3), in every card at once. */
  sidePanelOpen: boolean
  /** The side panel's width in pixels as last dragged (#55 D4), 200 to 4000. */
  sidePanelWidth: number
}

export const PREFERENCE_DEFAULTS: Readonly<Preferences> = Object.freeze({
  cursorStyle: 'block',
  cursorBlink: false,
  scrollback: 10000,
  optionAsMeta: false,
  copyOnSelect: false,
  lineHeight: 1,
  letterSpacing: 0,
  bell: 'none',
  boldBright: true,
  notifications: true,
  notificationSound: true,
  claudeStatus: true,
  sidePanelOpen: true,
  sidePanelWidth: 280
})

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const oneOf =
  <T>(values: readonly T[]) =>
  (v: unknown): v is T =>
    (values as readonly unknown[]).includes(v)

/** Each preference's check, in the order the file lists them. */
const PREFERENCE_CHECKS: { [K in keyof Preferences]: (v: unknown) => v is Preferences[K] } = {
  cursorStyle: oneOf(CURSOR_STYLES),
  cursorBlink: isBoolean,
  scrollback: oneOf(SCROLLBACK_CHOICES as readonly number[]),
  optionAsMeta: isBoolean,
  copyOnSelect: isBoolean,
  lineHeight: (v): v is number =>
    typeof v === 'number' &&
    v >= MIN_LINE_HEIGHT &&
    v <= MAX_LINE_HEIGHT &&
    Math.abs(Math.round(v * 10) - v * 10) < 1e-9,
  letterSpacing: (v): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_LETTER_SPACING,
  bell: oneOf(BELLS),
  boldBright: isBoolean,
  notifications: isBoolean,
  notificationSound: isBoolean,
  claudeStatus: isBoolean,
  sidePanelOpen: isBoolean,
  sidePanelWidth: (v): v is number =>
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= MIN_SIDE_PANEL_WIDTH &&
    v <= MAX_SIDE_PANEL_WIDTH
}

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_CHECKS) as (keyof Preferences)[]

export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32
export const MAX_FONT_FAMILY_LENGTH = 200
export const DEFAULT_FONT_FAMILY = 'Menlo, Consolas, monospace'

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: 'system',
  fontSize: 13,
  fontFamily: DEFAULT_FONT_FAMILY,
  shell: '',
  terminalThemeDark: DROVR_DARK,
  terminalThemeLight: DROVR_LIGHT,
  useGhosttyTheme: false,
  ...PREFERENCE_DEFAULTS
})

export const MAX_SHELL_LENGTH = 4096

/** '' (the login shell) or an absolute path of at most 4096 chars without control chars. */
export function isShellSetting(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '' ||
      (value.length <= MAX_SHELL_LENGTH &&
        !CONTROL_CHARS.test(value) &&
        /^(\/|[A-Za-z]:[\\/])/.test(value)))
  )
}

/** The window background of each resolved theme (D2), matching `--bg` in the CSS. */
export const THEME_BACKGROUNDS: Readonly<Record<ResolvedTheme, string>> = Object.freeze({
  dark: '#14151a',
  light: '#f6f7f9'
})

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export function isFontSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FONT_SIZE &&
    value <= MAX_FONT_SIZE
  )
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * The family to keep for `value`: trimmed, or the default when empty or whitespace only (D4);
 * null when it isn't a string, is longer than 200 chars after trimming or holds control chars.
 */
export function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH || CONTROL_CHARS.test(trimmed)) return null
  return trimmed === '' ? DEFAULT_FONT_FAMILY : trimmed
}

/**
 * Checks a `settings:save` payload: every field must be valid (D1), else null and nothing is
 * applied (D6). The result holds only D1's fields, with the family normalized, and the shortcuts
 * that differ from `platform`'s default when the whole set is valid (#31 D9).
 */
export function validateSettings(value: unknown, platform: string): Settings | null {
  if (!isObject(value)) return null
  const fontFamily = normalizeFontFamily(value.fontFamily)
  if (
    !isTheme(value.theme) ||
    !isFontSize(value.fontSize) ||
    fontFamily === null ||
    !isShellSetting(value.shell) ||
    !isTerminalThemeName(value.terminalThemeDark) ||
    !isTerminalThemeName(value.terminalThemeLight) ||
    typeof value.useGhosttyTheme !== 'boolean'
  ) {
    return null
  }
  const shortcuts = validateShortcuts(value.shortcuts, platform)
  if (shortcuts === null) return null
  // A missing preference is its default; an invalid one rejects the whole save (D6).
  const preferences = { ...PREFERENCE_DEFAULTS } as Record<keyof Preferences, unknown>
  for (const key of PREFERENCE_KEYS) {
    if (value[key] === undefined) continue
    if (!PREFERENCE_CHECKS[key](value[key])) return null
    preferences[key] = value[key]
  }
  return withShortcuts(
    {
      theme: value.theme,
      fontSize: value.fontSize,
      fontFamily,
      shell: value.shell,
      terminalThemeDark: value.terminalThemeDark,
      terminalThemeLight: value.terminalThemeLight,
      useGhosttyTheme: value.useGhosttyTheme,
      ...(preferences as Preferences)
    },
    shortcuts
  )
}

/** `settings` with `shortcuts`, left out when there are none. */
function withShortcuts(settings: Settings, shortcuts: ShortcutOverrides): Settings {
  return Object.keys(shortcuts).length > 0 ? { ...settings, shortcuts } : settings
}

export interface ParsedSettings {
  settings: Settings
  /** The sync folder (#13 D10), present only when the file holds a valid one; absent means off. */
  syncFolder?: string
  /**
   * The fields that were invalid or missing and took their default (D7); `shortcuts` when any
   * shortcut did (#31 D9).
   */
  replaced: (keyof Settings)[]
  /** Why the whole file was ignored, when it was. */
  rejected?: string
}

/**
 * Reads the file's contents (D7): not JSON, not an object or another version gives all
 * defaults; otherwise each field is checked on its own and an invalid or missing one takes its
 * default while the valid ones are kept; so is each shortcut, against `platform`'s defaults (#31 D9).
 */
export function parseSettingsFile(text: string, platform: string): ParsedSettings {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return rejectFile('not JSON')
  }
  if (!isObject(file)) return rejectFile('not an object')
  if (file.version !== SETTINGS_VERSION) return rejectFile('unsupported version')
  const raw = isObject(file.settings) ? file.settings : {}
  let settings: Settings = { ...DEFAULT_SETTINGS }
  const replaced: (keyof Settings)[] = []
  if (isTheme(raw.theme)) settings.theme = raw.theme
  else replaced.push('theme')
  if (isFontSize(raw.fontSize)) settings.fontSize = raw.fontSize
  else replaced.push('fontSize')
  const family = normalizeFontFamily(raw.fontFamily)
  if (family !== null) settings.fontFamily = family
  else replaced.push('fontFamily')
  // Absent in a file from before them: the default, not a replacement.
  const check = <
    K extends 'shell' | 'terminalThemeDark' | 'terminalThemeLight' | 'useGhosttyTheme'
  >(
    key: K,
    valid: (value: unknown) => value is Settings[K]
  ): void => {
    if (valid(raw[key])) settings[key] = raw[key]
    else if (key in raw) replaced.push(key)
  }
  check('shell', isShellSetting)
  check('terminalThemeDark', isTerminalThemeName)
  check('terminalThemeLight', isTerminalThemeName)
  check('useGhosttyTheme', (v): v is boolean => typeof v === 'boolean')
  for (const key of PREFERENCE_KEYS) {
    const raw_ = raw[key]
    if (PREFERENCE_CHECKS[key](raw_)) (settings as unknown as Record<string, unknown>)[key] = raw_
    else if (key in raw) replaced.push(key)
  }
  const { shortcuts, dropped } = readShortcuts(raw.shortcuts, platform)
  settings = withShortcuts(settings, shortcuts)
  if (dropped.length > 0) replaced.push('shortcuts')
  if (isSyncFolderPath(raw.syncFolder)) return { settings, replaced, syncFolder: raw.syncFolder }
  return { settings, replaced }
}

/**
 * The file contents for `settings`, fields in D6's order, then the shortcuts that differ from the
 * default (#31 D9) and the sync folder (#13 D10) when sync is on.
 */
export function serializeSettings(settings: Settings, syncFolder: string | null = null): string {
  const { theme, fontSize, fontFamily, shell, terminalThemeDark, terminalThemeLight, shortcuts } =
    settings
  return JSON.stringify({
    version: SETTINGS_VERSION,
    settings: {
      theme,
      fontSize,
      fontFamily,
      shell,
      terminalThemeDark,
      terminalThemeLight,
      useGhosttyTheme: settings.useGhosttyTheme,
      ...Object.fromEntries(
        PREFERENCE_KEYS.filter((key) => settings[key] !== PREFERENCE_DEFAULTS[key]).map((key) => [
          key,
          settings[key]
        ])
      ),
      ...(shortcuts !== undefined && Object.keys(shortcuts).length > 0 && { shortcuts }),
      ...(syncFolder !== null && { syncFolder })
    }
  })
}

export const MAX_SYNC_FOLDER_LENGTH = 4096

/**
 * A sync folder as the settings file may hold it (#13 D10): an absolute path (POSIX, or a Windows
 * drive path) of at most 4096 chars without NUL. Whether it exists is checked elsewhere.
 */
export function isSyncFolderPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_SYNC_FOLDER_LENGTH &&
    !value.includes('\0') &&
    /^(\/|[A-Za-z]:[\\/])/.test(value)
  )
}

/** The theme in effect: `system` follows the OS appearance (D2). */
export function resolveTheme(theme: Theme, osPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return osPrefersDark ? 'dark' : 'light'
  return theme
}

function rejectFile(reason: string): ParsedSettings {
  return { settings: { ...DEFAULT_SETTINGS }, replaced: [], rejected: reason }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
