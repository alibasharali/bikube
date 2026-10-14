/**
 * What every card terminal looks like (#10 D3, D4): the colour palette of each resolved theme and
 * the font from the settings. Plain TS; the palette's shape matches xterm.js's `ITheme`.
 */
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamily,
  resolveTheme,
  type ResolvedTheme,
  type Settings
} from './settings'

export const ANSI_COLOUR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const
export type AnsiColourName = (typeof ANSI_COLOUR_NAMES)[number]

export type TerminalPalette = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
} & Record<AnsiColourName, string>

export const TERMINAL_PALETTES: Readonly<Record<ResolvedTheme, Readonly<TerminalPalette>>> =
  Object.freeze({
    dark: Object.freeze({
      background: '#14151a',
      foreground: '#e6e7eb',
      cursor: '#e6e7eb',
      cursorAccent: '#14151a',
      selectionBackground: '#3a4565',
      black: '#1b1d24',
      red: '#e5484d',
      green: '#46a758',
      yellow: '#e2b93d',
      blue: '#6d8dfa',
      magenta: '#c26ad9',
      cyan: '#3eb3c4',
      white: '#c9ccd4',
      brightBlack: '#6b7080',
      brightRed: '#ff7a7e',
      brightGreen: '#6fcf7f',
      brightYellow: '#f5d76e',
      brightBlue: '#9ab0ff',
      brightMagenta: '#dd94ee',
      brightCyan: '#6fd4e2',
      brightWhite: '#ffffff'
    }),
    // Readable on white (at least 3:1): yellow, white and bright white are darkened (D3).
    light: Object.freeze({
      background: '#ffffff',
      foreground: '#1b1d24',
      cursor: '#1b1d24',
      cursorAccent: '#ffffff',
      selectionBackground: '#c7d4fa',
      black: '#1b1d24',
      red: '#c4262c',
      green: '#2a7a3b',
      yellow: '#8a6400',
      blue: '#2f55cc',
      magenta: '#9b3bb5',
      cyan: '#14798a',
      white: '#6e7781',
      brightBlack: '#5d6170',
      brightRed: '#d1343a',
      brightGreen: '#2f8a43',
      brightYellow: '#9c7400',
      brightBlue: '#3d63dd',
      brightMagenta: '#a948c4',
      brightCyan: '#16869a',
      brightWhite: '#868e98'
    })
  })

export interface TerminalAppearance {
  fontSize: number
  fontFamily: string
  theme: Readonly<TerminalPalette>
}

/**
 * The terminal options for `settings` under the OS appearance: the resolved theme's palette, the
 * size, and the family trimmed, an empty one meaning the default (D4).
 */
export function terminalAppearance(settings: Settings, osPrefersDark: boolean): TerminalAppearance {
  return {
    fontSize: settings.fontSize,
    fontFamily: normalizeFontFamily(settings.fontFamily) ?? DEFAULT_FONT_FAMILY,
    theme: TERMINAL_PALETTES[resolveTheme(settings.theme, osPrefersDark)]
  }
}
