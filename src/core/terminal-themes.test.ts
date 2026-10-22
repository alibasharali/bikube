import { describe, expect, it } from 'vitest'
import { ANSI_COLOUR_NAMES, TERMINAL_PALETTES } from './terminal-palette'
import {
  BIKUBE_DARK,
  BIKUBE_LIGHT,
  TERMINAL_THEME_NAMES,
  filterThemeNames,
  isDarkPalette,
  isTerminalThemeName,
  terminalTheme
} from './terminal-themes'

describe('terminal themes', () => {
  it("lists Bikube's two palettes first, then every bundled Ghostty theme", () => {
    expect(TERMINAL_THEME_NAMES.slice(0, 2)).toEqual([BIKUBE_DARK, BIKUBE_LIGHT])
    expect(TERMINAL_THEME_NAMES.length).toBeGreaterThan(400)
    expect(new Set(TERMINAL_THEME_NAMES).size).toBe(TERMINAL_THEME_NAMES.length)
  })

  it("gives Bikube's own palettes for its names", () => {
    expect(terminalTheme(BIKUBE_DARK)).toBe(TERMINAL_PALETTES.dark)
    expect(terminalTheme(BIKUBE_LIGHT)).toBe(TERMINAL_PALETTES.light)
  })

  it("reads a Ghostty theme's colours as Ghostty's file has them", () => {
    // Ghostty's `Catppuccin Mocha` file.
    expect(terminalTheme('Catppuccin Mocha')).toMatchObject({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      red: '#f38ba8',
      brightWhite: '#bac2de'
    })
  })

  it('every theme is complete: #rrggbb colours for the background, foreground, cursor and all 16', () => {
    for (const name of TERMINAL_THEME_NAMES) {
      const theme = terminalTheme(name)!
      for (const key of [
        'background',
        'foreground',
        'cursor',
        'cursorAccent',
        'selectionBackground',
        ...ANSI_COLOUR_NAMES
      ]) {
        expect(theme[key as keyof typeof theme], `${name} ${key}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('knows its names, and nothing else', () => {
    expect(isTerminalThemeName('Dracula')).toBe(true)
    expect(isTerminalThemeName('dracula')).toBe(false)
    expect(isTerminalThemeName('toString')).toBe(false)
    expect(isTerminalThemeName(42)).toBe(false)
    expect(terminalTheme('No Such Theme')).toBeUndefined()
  })

  it('tells dark themes from light ones by their background', () => {
    expect(isDarkPalette(terminalTheme('Catppuccin Mocha')!)).toBe(true)
    expect(isDarkPalette(terminalTheme('Catppuccin Latte')!)).toBe(false)
    expect(isDarkPalette(TERMINAL_PALETTES.dark)).toBe(true)
    expect(isDarkPalette(TERMINAL_PALETTES.light)).toBe(false)
  })
})

describe('filterThemeNames', () => {
  it('keeps the themes of one appearance, matching every word in any case', () => {
    expect(filterThemeNames('catppuccin', 'dark')).toEqual([
      'Catppuccin Frappe',
      'Catppuccin Macchiato',
      'Catppuccin Mocha'
    ])
    expect(filterThemeNames('CATPPUCCIN', 'light')).toEqual(['Catppuccin Latte'])
    expect(filterThemeNames('tokyo night', 'all')).toContain('TokyoNight Day')
    expect(filterThemeNames('', 'all')).toEqual(TERMINAL_THEME_NAMES)
  })
})
