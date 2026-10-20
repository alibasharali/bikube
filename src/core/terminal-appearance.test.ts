import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS } from './settings'
import { GHOSTTY_DEFAULT_PALETTE } from './ghostty-config'
import {
  ANSI_COLOUR_NAMES,
  TERMINAL_PALETTES,
  terminalAppearance,
  withSymbols
} from './terminal-appearance'
import { terminalTheme } from './terminal-themes'

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('terminal palettes (#10 D3)', () => {
  it('dark is background #14151a and foreground #e6e7eb', () => {
    expect(TERMINAL_PALETTES.dark.background).toBe('#14151a')
    expect(TERMINAL_PALETTES.dark.foreground).toBe('#e6e7eb')
  })

  it('light is background #ffffff and foreground #1b1d24', () => {
    expect(TERMINAL_PALETTES.light.background).toBe('#ffffff')
    expect(TERMINAL_PALETTES.light.foreground).toBe('#1b1d24')
  })

  it('both set cursor, selection and the 16 ANSI colours as #rrggbb', () => {
    expect(ANSI_COLOUR_NAMES).toHaveLength(16)
    for (const palette of Object.values(TERMINAL_PALETTES)) {
      for (const key of ['cursor', 'cursorAccent', 'selectionBackground', ...ANSI_COLOUR_NAMES]) {
        expect(palette[key as keyof typeof palette], key).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('light ANSI colours are readable on white, yellow and bright white included', () => {
    const light = TERMINAL_PALETTES.light
    for (const name of ANSI_COLOUR_NAMES) {
      expect(contrast(light[name], light.background), name).toBeGreaterThanOrEqual(3)
    }
    expect(contrast(light.yellow, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(light.brightWhite, '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('the 16 ANSI colours of each palette are all different', () => {
    for (const palette of Object.values(TERMINAL_PALETTES)) {
      const colours = ANSI_COLOUR_NAMES.map((name) => palette[name])
      expect(new Set(colours).size).toBe(16)
    }
  })

  it('the foreground reads on the background in both', () => {
    for (const palette of Object.values(TERMINAL_PALETTES)) {
      expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(7)
    }
  })
})

describe('terminalAppearance (#10 D3, D4)', () => {
  it('defaults: 13 px Menlo, Consolas, monospace with the symbols font, Drovr Dark under a dark OS', () => {
    expect(terminalAppearance(DEFAULT_SETTINGS, true)).toEqual({
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace, "Symbols Nerd Font Mono"',
      theme: TERMINAL_PALETTES.dark,
      behaviour: {
        cursorStyle: 'block',
        cursorBlink: false,
        scrollback: 10000,
        macOptionIsMeta: false,
        lineHeight: 1,
        letterSpacing: 0,
        fontWeight: 400,
        drawBoldTextInBrightColors: true
      }
    })
  })

  it('passes the terminal preferences on as xterm options', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cursorStyle: 'underline',
      cursorBlink: true,
      scrollback: 50000,
      optionAsMeta: true,
      lineHeight: 1.3,
      letterSpacing: 2,
      fontWeight: 500,
      boldBright: false
    } as const
    expect(terminalAppearance(settings, true).behaviour).toEqual({
      cursorStyle: 'underline',
      cursorBlink: true,
      scrollback: 50000,
      macOptionIsMeta: true,
      lineHeight: 1.3,
      letterSpacing: 2,
      fontWeight: 500,
      drawBoldTextInBrightColors: false
    })
  })

  it('follows the resolved theme', () => {
    expect(terminalAppearance({ ...DEFAULT_SETTINGS }, false).theme).toBe(TERMINAL_PALETTES.light)
    expect(terminalAppearance({ ...DEFAULT_SETTINGS, theme: 'light' }, true).theme).toBe(
      TERMINAL_PALETTES.light
    )
    expect(terminalAppearance({ ...DEFAULT_SETTINGS, theme: 'dark' }, false).theme).toBe(
      TERMINAL_PALETTES.dark
    )
  })

  it('uses the size and the family trimmed (AC6, AC7)', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: 'light',
      fontSize: 16,
      fontFamily: '  Courier New, monospace  '
    } as const
    expect(terminalAppearance(settings, true)).toMatchObject({
      fontSize: 16,
      fontFamily: withSymbols('Courier New, monospace')
    })
  })

  it('an empty or whitespace-only family means the default', () => {
    for (const fontFamily of ['', '   ', '\t ']) {
      expect(terminalAppearance({ ...DEFAULT_SETTINGS, fontFamily }, true).fontFamily).toBe(
        withSymbols(DEFAULT_FONT_FAMILY)
      )
    }
  })

  it('uses the theme picked for the resolved app theme', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      terminalThemeDark: 'Catppuccin Mocha',
      terminalThemeLight: 'Catppuccin Latte'
    }
    expect(terminalAppearance({ ...settings, theme: 'dark' }, false).theme).toBe(
      terminalTheme('Catppuccin Mocha')
    )
    expect(terminalAppearance(settings, false).theme).toBe(terminalTheme('Catppuccin Latte'))
  })

  it("uses Ghostty's colours when that setting is on and they are read, the picked theme until then", () => {
    const ghostty = { dark: GHOSTTY_DEFAULT_PALETTE, light: TERMINAL_PALETTES.light }
    const on = { ...DEFAULT_SETTINGS, theme: 'dark' as const, useGhosttyTheme: true }
    expect(terminalAppearance(on, true, ghostty).theme).toBe(GHOSTTY_DEFAULT_PALETTE)
    expect(terminalAppearance(on, true, null).theme).toBe(TERMINAL_PALETTES.dark)
    expect(terminalAppearance({ ...on, useGhosttyTheme: false }, true, ghostty).theme).toBe(
      TERMINAL_PALETTES.dark
    )
  })
})
