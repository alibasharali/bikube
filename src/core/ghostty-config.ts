/**
 * Reads the terminal colours from the user's Ghostty config, for the "Use Ghostty theme" setting:
 * the config files Ghostty loads (and their `config-file` includes), the `theme` they name (one
 * theme, or `light:A,dark:B`) and the colours they set themselves, which win over the theme's.
 * Plain TS with injected file reading, so Vitest drives it with fake files.
 */
import { ghosttyTheme } from './terminal-themes'
import { ANSI_COLOUR_NAMES, type TerminalPalette } from './terminal-palette'

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
  /** `config-file` entries in order; `optional` ones (a leading `?`) may be missing. */
  includes: { path: string; optional: boolean }[]
  problems: string[]
}

/** Parses one Ghostty config or theme file: `key = value` lines, `#` comments. */
export function parseGhosttyFile(text: string): ParsedGhosttyFile {
  const parsed: ParsedGhosttyFile = { colours: {}, theme: null, includes: [], problems: [] }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = unquote(line.slice(eq + 1).trim())
    if (key === 'theme') parsed.theme = value
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

export interface GhosttyTheme {
  dark: Readonly<TerminalPalette>
  light: Readonly<TerminalPalette>
  /** The config files read, in order, `~/` for the home directory; empty when there are none. */
  files: string[]
  /** The `theme` value in effect, or null when none is set. */
  theme: string | null
  /** Things that couldn't be applied, e.g. a theme not found; shown under the setting. */
  problems: string[]
}

const MAX_INCLUDE_DEPTH = 10

/** Reads the user's Ghostty colours as Ghostty would; never throws. */
export async function readGhosttyTheme(env: GhosttyEnv): Promise<GhosttyTheme> {
  const xdg = env.xdgConfigHome || join(env.home, '.config')
  const candidates = [join(xdg, 'ghostty', 'config'), join(xdg, 'ghostty', 'config.ghostty')]
  if (env.platform === 'darwin') {
    const app = join(env.home, 'Library', 'Application Support', 'com.mitchellh.ghostty')
    candidates.push(join(app, 'config'), join(app, 'config.ghostty'))
  }

  const files: string[] = []
  const problems: string[] = []
  const colours: Colours = {}
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
  return {
    dark: build(darkTheme),
    light: build(lightTheme),
    files: files.map((path) =>
      path.startsWith(`${env.home}/`) ? `~/${path.slice(env.home.length + 1)}` : path
    ),
    theme: variants === null ? null : theme,
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
