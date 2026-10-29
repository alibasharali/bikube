/**
 * Reads the user's Ghostty config, for the "Use Ghostty config" setting: the config files Ghostty
 * loads (and their `config-file` includes), the `theme` they name (one theme, or `light:A,dark:B`)
 * and the colours they set themselves, which win over the theme's; the terminal options Bikube
 * has a setting for (`GhosttyTerminalSettings`); and the `keybind` lines, for "Use Ghostty
 * shortcuts" (`ghostty-keybinds.ts`). Plain TS with injected file reading, so Vitest drives it
 * with fake files.
 */
import { ghosttyTheme } from './terminal-themes'
import { ANSI_COLOUR_NAMES, type TerminalPalette } from './terminal-palette'
import {
  MAX_FONT_SIZE,
  MAX_TERMINAL_PADDING,
  MIN_FONT_SIZE,
  MIN_UNFOCUSED_PANE_OPACITY,
  type Preferences,
  type Settings
} from './settings'

/** Ghostty's own colours when nothing sets them (`ghostty +show-config --default`, 1.3). */
export const GHOSTTY_DEFAULT_PALETTE: Readonly<TerminalPalette> = Object.freeze({
  background: '#282c34',
  foreground: '#ffffff',
  cursor: '#ffffff',
  cursorAccent: '#282c34',
  selectionBackground: '#ffffff',
  selectionForeground: '#282c34',
  black: '#1d1f21',
  red: '#cc6666',
  green: '#b5bd68',
  yellow: '#f0c674',
  blue: '#81a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c5c8c6',
  brightBlack: '#666666',
  brightRed: '#d54e53',
  brightGreen: '#b9ca4a',
  brightYellow: '#e7c547',
  brightBlue: '#7aa6da',
  brightMagenta: '#c397d8',
  brightCyan: '#70c0b1',
  brightWhite: '#eaeaea'
})

/** The colours a file sets, as the palette's own keys; null resets one (an empty value). */
type Colours = Partial<Record<keyof TerminalPalette, string | null>>

const KEY_TO_PALETTE: Readonly<Record<string, keyof TerminalPalette>> = {
  background: 'background',
  foreground: 'foreground',
  'cursor-color': 'cursor',
  'cursor-text': 'cursorAccent',
  'selection-background': 'selectionBackground',
  'selection-foreground': 'selectionForeground'
}

export interface ParsedGhosttyFile {
  colours: Colours
  /** The last `theme` value; null when the file sets none, '' when it resets it. */
  theme: string | null
  /** The last value of each `TERMINAL_KEYS` key the file sets. */
  options: Record<string, string>
  /** `font-family` values in order; '' resets the list (Ghostty's way of starting it over). */
  fontFamilies: string[]
  /** `keybind` values in order. */
  keybinds: string[]
  /** `config-file` entries in order; `optional` ones (a leading `?`) may be missing. */
  includes: { path: string; optional: boolean }[]
  problems: string[]
}

/** The Ghostty options Bikube reads besides colours, fonts and keybinds. */
const TERMINAL_KEYS = new Set([
  'font-size',
  'font-thicken',
  'cursor-style',
  'cursor-style-blink',
  'adjust-cell-height',
  'copy-on-select',
  'macos-option-as-alt',
  'window-padding-x',
  'window-padding-y',
  'unfocused-split-opacity',
  'split-divider-color',
  'mouse-hide-while-typing'
])

/** The settings a Ghostty config can set, as Bikube's own values; "Use Ghostty config" applies them. */
export type GhosttyTerminalSettings = Partial<
  Pick<Settings, 'fontFamily' | 'fontSize'> &
    Pick<
      Preferences,
      | 'fontWeight'
      | 'cursorStyle'
      | 'cursorBlink'
      | 'lineHeight'
      | 'copyOnSelect'
      | 'optionAsMeta'
      | 'paddingX'
      | 'paddingY'
      | 'unfocusedPaneOpacity'
      | 'paneDividerColor'
      | 'hideMouseWhileTyping'
    >
>

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

function ghosttyBoolean(value: string | undefined): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined
}

/** A family name as one CSS font family: quoted unless it is a generic or single-word name. */
function cssFamily(name: string): string {
  return /^[A-Za-z][\w-]*$/.test(name) ? name : `"${name.replace(/["\\]/g, '')}"`
}

/**
 * Bikube's values for the options a config sets (only those: the rest keep Bikube's own), each
 * rounded or clamped into its setting's range; `notApplied` names what was set but has no Bikube
 * equivalent as given, e.g. `copy-on-select = true` (Ghostty's selection clipboard, which Bikube
 * doesn't have: only `clipboard` turns Bikube's on).
 */
export function ghosttyTerminalSettings(
  options: Readonly<Record<string, string>>,
  fontFamilies: readonly string[]
): { settings: GhosttyTerminalSettings; notApplied: string[] } {
  const settings: GhosttyTerminalSettings = {}
  const notApplied: string[] = []
  // An empty `font-family` starts the list over.
  const families = fontFamilies.slice(fontFamilies.lastIndexOf('') + 1)
  if (families.length > 0)
    settings.fontFamily = [...families.map(cssFamily), 'monospace'].join(', ')
  const size = Number(options['font-size'])
  if (options['font-size'] && Number.isFinite(size)) {
    settings.fontSize = clamp(Math.round(size), MIN_FONT_SIZE, MAX_FONT_SIZE)
  }
  // Ghostty draws thicker text with font-thicken; Medium is Bikube's equivalent.
  const thicken = ghosttyBoolean(options['font-thicken'])
  if (thicken !== undefined) settings.fontWeight = thicken ? 500 : 400
  const cursor = options['cursor-style']
  if (cursor === 'bar' || cursor === 'underline' || cursor === 'block')
    settings.cursorStyle = cursor
  else if (cursor === 'block_hollow') settings.cursorStyle = 'block'
  const blink = ghosttyBoolean(options['cursor-style-blink'])
  if (blink !== undefined) settings.cursorBlink = blink
  const cellHeight = options['adjust-cell-height']
  if (cellHeight !== undefined) {
    const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(cellHeight)
    const pixels = /^(-?\d+)$/.exec(cellHeight)
    const fontSize = settings.fontSize ?? 13
    // Ghostty's cell is about 1.2 times the font size; a pixel adjustment is a share of that.
    const extra = percent
      ? Number(percent[1]) / 100
      : pixels
        ? Number(pixels[1]) / (fontSize * 1.2)
        : NaN
    if (Number.isFinite(extra)) settings.lineHeight = clamp(Math.round((1 + extra) * 10) / 10, 1, 2)
  }
  const copy = options['copy-on-select']
  if (copy === 'clipboard') settings.copyOnSelect = true
  else if (copy === 'false') settings.copyOnSelect = false
  else if (copy === 'true') notApplied.push('copy-on-select = true')
  const optionAlt = options['macos-option-as-alt']
  if (optionAlt === 'true' || optionAlt === 'left' || optionAlt === 'right')
    settings.optionAsMeta = true
  else if (optionAlt === 'false') settings.optionAsMeta = false
  // `10` or `left,right`: Bikube pads both sides alike, so the larger one.
  const padding = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const parts = value.split(',').map((part) => Number(part.trim()))
    if (parts.length > 2 || !parts.every(Number.isFinite)) return undefined
    return clamp(Math.round(Math.max(...parts)), 0, MAX_TERMINAL_PADDING)
  }
  const paddingX = padding(options['window-padding-x'])
  if (paddingX !== undefined) settings.paddingX = paddingX
  const paddingY = padding(options['window-padding-y'])
  if (paddingY !== undefined) settings.paddingY = paddingY
  const opacity = Number(options['unfocused-split-opacity'])
  if (options['unfocused-split-opacity'] && Number.isFinite(opacity)) {
    settings.unfocusedPaneOpacity = clamp(
      Math.round(opacity * 100) / 100,
      MIN_UNFOCUSED_PANE_OPACITY,
      1
    )
  }
  const divider = options['split-divider-color']
  if (divider !== undefined) {
    const colour = hexColour(divider)
    if (colour !== null) settings.paneDividerColor = colour
    else if (divider !== '') notApplied.push(`split-divider-color = ${divider}`)
  }
  const hideMouse = ghosttyBoolean(options['mouse-hide-while-typing'])
  if (hideMouse !== undefined) settings.hideMouseWhileTyping = hideMouse
  return { settings, notApplied }
}

/** Parses one Ghostty config or theme file: `key = value` lines, `#` comments. */
export function parseGhosttyFile(text: string): ParsedGhosttyFile {
  const parsed: ParsedGhosttyFile = {
    colours: {},
    theme: null,
    options: {},
    fontFamilies: [],
    keybinds: [],
    includes: [],
    problems: []
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = unquote(line.slice(eq + 1).trim())
    if (key === 'theme') parsed.theme = value
    else if (key === 'font-family') parsed.fontFamilies.push(value)
    else if (key === 'keybind') parsed.keybinds.push(value)
    else if (TERMINAL_KEYS.has(key)) parsed.options[key] = value
    else if (key === 'config-file' && value !== '') {
      const optional = value.startsWith('?')
      parsed.includes.push({ path: unquote(optional ? value.slice(1) : value), optional })
    } else if (key === 'palette') {
      const entry = /^(\d+)\s*=\s*(.+)$/.exec(value)
      const index = entry ? Number(entry[1]) : NaN
      // Only the 16 ANSI colours; the 256-colour cube stays xterm's.
      if (index < 16) setColour(parsed, ANSI_COLOUR_NAMES[index]!, entry![2]!)
    } else if (Object.hasOwn(KEY_TO_PALETTE, key)) {
      if (value === '') parsed.colours[KEY_TO_PALETTE[key]!] = null
      else setColour(parsed, KEY_TO_PALETTE[key]!, value)
    }
  }
  return parsed
}

function setColour(parsed: ParsedGhosttyFile, key: keyof TerminalPalette, value: string): void {
  const colour = hexColour(value)
  if (colour === null) parsed.problems.push(`unsupported colour "${value}"`)
  else parsed.colours[key] = colour
}

/** `#rrggbb` for a hex colour with or without `#` (6 or 3 digits), else null. */
export function hexColour(value: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim())
  if (!m) return null
  const hex = m[1]!.toLowerCase()
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

/** The theme for each appearance from a `theme` value: `A`, or `light:A,dark:B` in any order. */
export function splitThemeValue(value: string): { light: string; dark: string } | null {
  if (value === '') return null
  const parts = value.split(',').map((part) => part.trim())
  const named: Record<string, string> = {}
  for (const part of parts) {
    const m = /^(light|dark):(.+)$/.exec(part)
    if (m) named[m[1]!] = m[2]!.trim()
  }
  if (named.light !== undefined || named.dark !== undefined) {
    const either = (named.dark ?? named.light)!
    return { light: named.light ?? either, dark: named.dark ?? either }
  }
  return { light: value, dark: value }
}

export interface GhosttyEnv {
  /** Reads a whole file; null when it is missing or unreadable. */
  readFile(path: string): Promise<string | null>
  home: string
  /** `XDG_CONFIG_HOME`; `~/.config` when unset or empty. */
  xdgConfigHome?: string
  platform: NodeJS.Platform
}

export interface GhosttyConfig {
  dark: Readonly<TerminalPalette>
  light: Readonly<TerminalPalette>
  /** The config files read, in order, `~/` for the home directory; empty when there are none. */
  files: string[]
  /** The `theme` value in effect, or null when none is set. */
  theme: string | null
  /** The terminal settings the config sets, as Bikube's values. */
  terminal: GhosttyTerminalSettings
  /** Every `keybind` value in load order, for "Use Ghostty shortcuts". */
  keybinds: string[]
  /** Things that couldn't be applied, e.g. a theme not found; shown under the setting. */
  problems: string[]
}

const MAX_INCLUDE_DEPTH = 10

/** Reads the user's Ghostty config as Ghostty would; never throws. */
export async function readGhosttyConfig(env: GhosttyEnv): Promise<GhosttyConfig> {
  const xdg = env.xdgConfigHome || join(env.home, '.config')
  const candidates = [join(xdg, 'ghostty', 'config'), join(xdg, 'ghostty', 'config.ghostty')]
  if (env.platform === 'darwin') {
    const app = join(env.home, 'Library', 'Application Support', 'com.mitchellh.ghostty')
    candidates.push(join(app, 'config'), join(app, 'config.ghostty'))
  }

  const files: string[] = []
  const problems: string[] = []
  const colours: Colours = {}
  const options: Record<string, string> = {}
  const fontFamilies: string[] = []
  const keybinds: string[] = []
  let theme = null as string | null
  const load = async (path: string, optional: boolean, depth: number): Promise<void> => {
    if (files.includes(path)) return
    const text = await env.readFile(path)
    if (text === null) {
      if (!optional) problems.push(`config-file not found: ${path}`)
      return
    }
    files.push(path)
    const parsed = parseGhosttyFile(text)
    Object.assign(colours, parsed.colours)
    Object.assign(options, parsed.options)
    fontFamilies.push(...parsed.fontFamilies)
    keybinds.push(...parsed.keybinds)
    if (parsed.theme !== null) theme = parsed.theme
    problems.push(...parsed.problems.map((p) => `${path}: ${p}`))
    // Ghostty loads includes after the file that names them, relative to its directory.
    if (depth >= MAX_INCLUDE_DEPTH) return
    for (const include of parsed.includes) {
      const target = resolvePath(include.path, dirname(path), env.home)
      await load(target, include.optional, depth + 1)
    }
  }
  for (const path of candidates) await load(path, true, 0)

  const variants = theme === null ? null : splitThemeValue(theme)
  const themed = async (name: string | undefined): Promise<Colours> => {
    if (name === undefined) return {}
    const found = await findTheme(name, env, xdg)
    if (found === null) problems.push(`theme not found: ${name}`)
    return found ?? {}
  }
  const darkTheme = await themed(variants?.dark)
  const lightTheme = variants?.light === variants?.dark ? darkTheme : await themed(variants?.light)
  const build = (themeColours: Colours): Readonly<TerminalPalette> =>
    Object.freeze(complete(set({ ...themeColours, ...colours })))
  const terminal = ghosttyTerminalSettings(options, fontFamilies)
  problems.push(...terminal.notApplied.map((setting) => `not applied: ${setting}`))
  return {
    dark: build(darkTheme),
    light: build(lightTheme),
    files: files.map((path) =>
      path.startsWith(`${env.home}/`) ? `~/${path.slice(env.home.length + 1)}` : path
    ),
    theme: variants === null ? null : theme,
    terminal: terminal.settings,
    keybinds,
    problems
  }
}

/** Looks `name` up as Ghostty does: a path, the user's themes, Ghostty's own, then Bikube's copy. */
async function findTheme(name: string, env: GhosttyEnv, xdg: string): Promise<Colours | null> {
  const dirs = [join(xdg, 'ghostty', 'themes')]
  if (env.platform === 'darwin')
    dirs.push('/Applications/Ghostty.app/Contents/Resources/ghostty/themes')
  else dirs.push('/usr/share/ghostty/themes', '/usr/local/share/ghostty/themes')
  const paths =
    isAbsolute(name) || name.startsWith('~/')
      ? [resolvePath(name, '/', env.home)]
      : name.includes('/') || name.includes('\\')
        ? []
        : dirs.map((dir) => join(dir, name))
  for (const path of paths) {
    const text = await env.readFile(path)
    if (text !== null) return parseGhosttyFile(text).colours
  }
  // The theme files Bikube bundles are Ghostty's, so a theme Ghostty ships is found without it.
  const bundled = ghosttyTheme(name)
  return bundled ? { ...bundled } : null
}

/** The colours actually set: a reset (null) leaves Ghostty's default. */
function set(colours: Colours): Partial<TerminalPalette> {
  return Object.fromEntries(Object.entries(colours).filter(([, v]) => v !== null))
}

/** Fills what neither the theme nor the config set from Ghostty's defaults. */
function complete(colours: Partial<TerminalPalette>): TerminalPalette {
  const background = colours.background ?? GHOSTTY_DEFAULT_PALETTE.background
  const foreground = colours.foreground ?? GHOSTTY_DEFAULT_PALETTE.foreground
  const palette: TerminalPalette = {
    ...GHOSTTY_DEFAULT_PALETTE,
    ...colours,
    background,
    foreground,
    cursor: colours.cursor ?? foreground,
    cursorAccent: colours.cursorAccent ?? background,
    selectionBackground: colours.selectionBackground ?? foreground
  }
  // Without a selection colour, Ghostty inverts: the foreground behind text in the background.
  palette.selectionForeground =
    colours.selectionForeground ?? (colours.selectionBackground ? undefined : background)
  if (palette.selectionForeground === undefined) delete palette.selectionForeground
  return palette
}

function resolvePath(path: string, base: string, home: string): string {
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return isAbsolute(path) ? path : join(base, path)
}

// Plain path helpers (POSIX), so the module needs no Node imports and stays renderer-safe.
function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

/**
 * `settings` as they apply with "Use Ghostty config": every terminal setting the config sets
 * instead of Bikube's own. Unchanged while it is off or the config isn't read yet.
 */
export function withGhosttyConfig(settings: Settings, ghostty: GhosttyConfig | null): Settings {
  if (!settings.useGhosttyConfig || ghostty === null) return settings
  return { ...settings, ...ghostty.terminal }
}
