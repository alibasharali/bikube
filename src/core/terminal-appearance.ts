/**
 * What every card terminal looks like (#10 D3, D4): the colour theme picked for the resolved app
 * theme (or the user's Ghostty colours), and the font from the settings with the bundled Nerd
 * Font symbols as a fallback. Plain TS; the palette's shape matches xterm.js's `ITheme`.
 */
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamily,
  resolveTheme,
  type ResolvedTheme,
  type Settings
} from './settings'
import { TERMINAL_PALETTES, type TerminalPalette } from './terminal-palette'
import { terminalTheme } from './terminal-themes'

export {
  ANSI_COLOUR_NAMES,
  TERMINAL_PALETTES,
  type AnsiColourName,
  type TerminalPalette
} from './terminal-palette'

/** The icon font Drovr bundles, so prompts like starship show their Nerd Font glyphs. */
export const SYMBOLS_FONT_FAMILY = 'Symbols Nerd Font Mono'

/** The xterm.js options the terminal preferences set (names as xterm's `ITerminalOptions`). */
export interface TerminalBehaviour {
  cursorStyle: Settings['cursorStyle']
  cursorBlink: boolean
  scrollback: number
  macOptionIsMeta: boolean
  lineHeight: number
  letterSpacing: number
  fontWeight: number
  drawBoldTextInBrightColors: boolean
}

export interface TerminalAppearance {
  fontSize: number
  fontFamily: string
  theme: Readonly<TerminalPalette>
  behaviour: TerminalBehaviour
}

/** The Ghostty colours for each appearance, once read; null while not read or not in use. */
export type GhosttyPalettes = Readonly<Record<ResolvedTheme, Readonly<TerminalPalette>>> | null

/**
 * The terminal options for `settings` under the OS appearance: the palette of the theme picked
 * for the resolved app theme, or Ghostty's when that setting is on and they are read; the size,
 * and the family trimmed, an empty one meaning the default (D4), then the symbols font.
 */
export function terminalAppearance(
  settings: Settings,
  osPrefersDark: boolean,
  ghostty: GhosttyPalettes = null
): TerminalAppearance {
  const resolved = resolveTheme(settings.theme, osPrefersDark)
  return {
    fontSize: settings.fontSize,
    fontFamily: withSymbols(normalizeFontFamily(settings.fontFamily) ?? DEFAULT_FONT_FAMILY),
    theme: terminalPalette(settings, resolved, ghostty),
    behaviour: {
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      macOptionIsMeta: settings.optionAsMeta,
      lineHeight: settings.lineHeight,
      letterSpacing: settings.letterSpacing,
      fontWeight: settings.fontWeight,
      drawBoldTextInBrightColors: settings.boldBright
    }
  }
}

export function terminalPalette(
  settings: Settings,
  resolved: ResolvedTheme,
  ghostty: GhosttyPalettes = null
): Readonly<TerminalPalette> {
  if (settings.useGhosttyTheme && ghostty !== null) return ghostty[resolved]
  const name = resolved === 'dark' ? settings.terminalThemeDark : settings.terminalThemeLight
  return terminalTheme(name) ?? TERMINAL_PALETTES[resolved]
}

/** `family` with the symbols font last, so it only fills glyphs the family lacks. */
export function withSymbols(family: string): string {
  return `${family}, "${SYMBOLS_FONT_FAMILY}"`
}
