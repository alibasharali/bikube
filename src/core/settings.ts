/**
 * App-wide settings (#10 D1) and their file format (D6, D7). Plain TS with no Electron or Node
 * imports, so main and the renderer can both use it. The file holds
 * `{ "version": 1, "settings": { "theme", "fontSize", "fontFamily", "syncFolder"? } }`.
 *
 * `syncFolder` (#13 D10) is kept per machine in the same file but is not part of `Settings`:
 * `settings:save` never carries or changes it, only the sync channels do. It is written only while
 * sync is on; absent (or invalid) means off.
 *
 * `fontFamily` is always the family in effect: a typed family is trimmed, and an empty one
 * becomes the default (D4), so the file and every reader see the actual family.
 */

export const SETTINGS_FILE_NAME = 'drovr-settings.json'
export const SETTINGS_VERSION = 1

export const THEMES = ['system', 'dark', 'light'] as const
export type Theme = (typeof THEMES)[number]
/** The theme a window shows once `system` is resolved against the OS appearance. */
export type ResolvedTheme = 'dark' | 'light'

export interface Settings {
  theme: Theme
  fontSize: number
  fontFamily: string
}

export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32
export const MAX_FONT_FAMILY_LENGTH = 200
export const DEFAULT_FONT_FAMILY = 'Menlo, Consolas, monospace'

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: 'system',
  fontSize: 13,
  fontFamily: DEFAULT_FONT_FAMILY
})

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
 * applied (D6). The result holds only D1's fields, with the family normalized.
 */
export function validateSettings(value: unknown): Settings | null {
  if (!isObject(value)) return null
  const fontFamily = normalizeFontFamily(value.fontFamily)
  if (!isTheme(value.theme) || !isFontSize(value.fontSize) || fontFamily === null) return null
  return { theme: value.theme, fontSize: value.fontSize, fontFamily }
}

export interface ParsedSettings {
  settings: Settings
  /** The sync folder (#13 D10), present only when the file holds a valid one; absent means off. */
  syncFolder?: string
  /** The fields that were invalid or missing and took their default (D7). */
  replaced: (keyof Settings)[]
  /** Why the whole file was ignored, when it was. */
  rejected?: string
}

/**
 * Reads the file's contents (D7): not JSON, not an object or another version gives all
 * defaults; otherwise each field is checked on its own and an invalid or missing one takes its
 * default while the valid ones are kept.
 */
export function parseSettingsFile(text: string): ParsedSettings {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return rejectFile('not JSON')
  }
  if (!isObject(file)) return rejectFile('not an object')
  if (file.version !== SETTINGS_VERSION) return rejectFile('unsupported version')
  const raw = isObject(file.settings) ? file.settings : {}
  const settings: Settings = { ...DEFAULT_SETTINGS }
  const replaced: (keyof Settings)[] = []
  if (isTheme(raw.theme)) settings.theme = raw.theme
  else replaced.push('theme')
  if (isFontSize(raw.fontSize)) settings.fontSize = raw.fontSize
  else replaced.push('fontSize')
  const family = normalizeFontFamily(raw.fontFamily)
  if (family !== null) settings.fontFamily = family
  else replaced.push('fontFamily')
  if (isSyncFolderPath(raw.syncFolder)) return { settings, replaced, syncFolder: raw.syncFolder }
  return { settings, replaced }
}

/**
 * The file contents for `settings`, fields in D6's order, then the sync folder (#13 D10) when sync
 * is on.
 */
export function serializeSettings(settings: Settings, syncFolder: string | null = null): string {
  const { theme, fontSize, fontFamily } = settings
  return JSON.stringify({
    version: SETTINGS_VERSION,
    settings: { theme, fontSize, fontFamily, ...(syncFolder !== null && { syncFolder }) }
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
