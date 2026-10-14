/**
 * The terminal colour themes to pick from: Drovr's own two palettes and every theme Ghostty ships
 * (from iTerm2-Color-Schemes, MIT; `scripts/import-ghostty-themes.mjs` builds the JSON). Plain TS.
 */
import GHOSTTY_THEMES from './ghostty-themes.json'
import { ANSI_COLOUR_NAMES, TERMINAL_PALETTES, type TerminalPalette } from './terminal-palette'

export const DROVR_DARK = 'Drovr Dark'
export const DROVR_LIGHT = 'Drovr Light'

const BUILT_IN: Readonly<Record<string, Readonly<TerminalPalette>>> = {
  [DROVR_DARK]: TERMINAL_PALETTES.dark,
  [DROVR_LIGHT]: TERMINAL_PALETTES.light
}

const RAW = GHOSTTY_THEMES as Record<string, string>

/** Every theme name, Drovr's first, then Ghostty's in their file order (case-insensitive A–Z). */
export const TERMINAL_THEME_NAMES: readonly string[] = Object.freeze([
  DROVR_DARK,
  DROVR_LIGHT,
  ...Object.keys(RAW)
])

const cache = new Map<string, Readonly<TerminalPalette>>()

export function isTerminalThemeName(value: unknown): value is string {
  return typeof value === 'string' && (Object.hasOwn(BUILT_IN, value) || Object.hasOwn(RAW, value))
}

/** The palette of the theme `name`, or undefined for an unknown name. */
export function terminalTheme(name: string): Readonly<TerminalPalette> | undefined {
  return Object.hasOwn(BUILT_IN, name) ? BUILT_IN[name] : ghosttyTheme(name)
}

/** The palette of the Ghostty theme `name` Drovr bundles, or undefined. */
export function ghosttyTheme(name: string): Readonly<TerminalPalette> | undefined {
  if (!Object.hasOwn(RAW, name)) return undefined
  let palette = cache.get(name)
  if (!palette) {
    palette = Object.freeze(fromRow(RAW[name]!.split(' ')))
    cache.set(name, palette)
  }
  return palette
}

/**
 * A row of the JSON: background, foreground, cursor, cursor text, selection background and
 * foreground (the last four may be empty), then the 16 ANSI colours, as hex without `#`.
 */
function fromRow(row: string[]): TerminalPalette {
  const colour = (i: number): string | undefined => (row[i] ? `#${row[i]}` : undefined)
  const background = colour(0)!
  const foreground = colour(1)!
  const palette: TerminalPalette = {
    background,
    foreground,
    cursor: colour(2) ?? foreground,
    cursorAccent: colour(3) ?? background,
    selectionBackground: colour(4) ?? foreground,
    ...(Object.fromEntries(ANSI_COLOUR_NAMES.map((name, i) => [name, colour(6 + i)!])) as Record<
      (typeof ANSI_COLOUR_NAMES)[number],
      string
    >)
  }
  const selectionForeground = colour(5)
  if (selectionForeground) palette.selectionForeground = selectionForeground
  return palette
}

/** True for a palette whose background is dark (relative luminance below a quarter). */
export function isDarkPalette(palette: Pick<TerminalPalette, 'background'>): boolean {
  return relativeLuminance(palette.background) < 0.25
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export type ThemeFilter = 'dark' | 'light' | 'all'

let darkNames: Set<string> | undefined

/** The themes matching `filter` and every word of `query` (any case), in list order. */
export function filterThemeNames(query: string, filter: ThemeFilter): string[] {
  darkNames ??= new Set(TERMINAL_THEME_NAMES.filter((name) => isDarkPalette(terminalTheme(name)!)))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return TERMINAL_THEME_NAMES.filter(
    (name) =>
      (filter === 'all' || darkNames!.has(name) === (filter === 'dark')) &&
      words.every((word) => name.toLowerCase().includes(word))
  )
}
