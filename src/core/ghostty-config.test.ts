import { describe, expect, it } from 'vitest'
import {
  GHOSTTY_DEFAULT_PALETTE,
  ghosttyTerminalSettings,
  hexColour,
  parseGhosttyFile,
  readGhosttyConfig,
  splitThemeValue,
  withGhosttyConfig,
  type GhosttyEnv
} from './ghostty-config'
import { DEFAULT_SETTINGS } from './settings'
import { terminalTheme } from './terminal-themes'

const HOME = '/home/me'
const XDG_CONFIG = `${HOME}/.config/ghostty/config`
const MAC_CONFIG = `${HOME}/Library/Application Support/com.mitchellh.ghostty/config`
/** A path as `files` shows it. */
const shown = (path: string): string => path.replace(`${HOME}/`, '~/')

function env(files: Record<string, string>, platform: NodeJS.Platform = 'linux'): GhosttyEnv {
  return { readFile: async (path) => files[path] ?? null, home: HOME, platform }
}

describe('parseGhosttyFile', () => {
  it('reads colours, palette entries, the theme and includes, skipping comments', () => {
    const parsed = parseGhosttyFile(
      [
        '# a comment',
        'theme = "Dracula"',
        'background = 101010',
        'palette = 1=#ff0000',
        'palette = 200=#123456',
        'cursor-color = #abc',
        'config-file = ?extra',
        'font-family = Iosevka'
      ].join('\n')
    )
    expect(parsed.theme).toBe('Dracula')
    expect(parsed.colours).toEqual({ background: '#101010', red: '#ff0000', cursor: '#aabbcc' })
    expect(parsed.includes).toEqual([{ path: 'extra', optional: true }])
  })

  it('notes a colour it cannot read, e.g. an X11 name', () => {
    expect(parseGhosttyFile('foreground = rebeccapurple').problems).toEqual([
      'unsupported colour "rebeccapurple"'
    ])
  })
})

describe('hexColour', () => {
  it.each([
    ['#AABBCC', '#aabbcc'],
    ['aabbcc', '#aabbcc'],
    ['#abc', '#aabbcc'],
    ['red', null],
    ['#abcd', null]
  ])('%s → %s', (value, expected) => {
    expect(hexColour(value)).toBe(expected)
  })
})

describe('splitThemeValue', () => {
  it('uses one theme for both appearances', () => {
    expect(splitThemeValue('Nord')).toEqual({ light: 'Nord', dark: 'Nord' })
  })

  it('splits light: and dark:, in any order, and fills a missing one from the other', () => {
    expect(splitThemeValue('dark:Nord, light:Nord Light')).toEqual({
      light: 'Nord Light',
      dark: 'Nord'
    })
    expect(splitThemeValue('dark:Nord')).toEqual({ light: 'Nord', dark: 'Nord' })
  })
})

describe('readGhosttyConfig', () => {
  it("gives Ghostty's default colours without a config", async () => {
    const theme = await readGhosttyConfig(env({}))
    expect(theme).toMatchObject({ files: [], theme: null, problems: [] })
    expect(theme.dark).toEqual(GHOSTTY_DEFAULT_PALETTE)
    expect(theme.light).toEqual(GHOSTTY_DEFAULT_PALETTE)
  })

  it("uses a bundled theme Ghostty ships, for each appearance, as macOS's config names it", async () => {
    const theme = await readGhosttyConfig(
      env({ [MAC_CONFIG]: 'theme = light:Catppuccin Latte,dark:Catppuccin Mocha' }, 'darwin')
    )
    expect(theme.files).toEqual([shown(MAC_CONFIG)])
    expect(theme.dark).toMatchObject({ ...terminalTheme('Catppuccin Mocha') })
    expect(theme.light).toMatchObject({ ...terminalTheme('Catppuccin Latte') })
  })

  it("prefers the user's own theme file, and lets the config's colours win over the theme's", async () => {
    const theme = await readGhosttyConfig(
      env({
        [XDG_CONFIG]: 'theme = Mine\nbackground = #000000',
        [`${HOME}/.config/ghostty/themes/Mine`]: 'background = #111111\npalette = 2=#00ff00'
      })
    )
    expect(theme.dark).toMatchObject({ background: '#000000', green: '#00ff00' })
  })

  it('follows config-file includes after the file, relative to it, and later values win', async () => {
    const theme = await readGhosttyConfig(
      env({
        [XDG_CONFIG]: 'config-file = colours\nforeground = #111111\nbackground = #222222',
        [`${HOME}/.config/ghostty/colours`]: 'background = #333333',
        [`${HOME}/.config/ghostty/config.ghostty`]: 'foreground = #444444'
      })
    )
    expect(theme.files).toEqual([
      '~/.config/ghostty/config',
      '~/.config/ghostty/colours',
      '~/.config/ghostty/config.ghostty'
    ])
    expect(theme.dark).toMatchObject({ background: '#333333', foreground: '#444444' })
  })

  it('reports a theme it cannot find and a required include that is missing', async () => {
    const theme = await readGhosttyConfig(
      env({ [XDG_CONFIG]: 'theme = Nope\nconfig-file = /missing' })
    )
    expect(theme.problems).toEqual(['config-file not found: /missing', 'theme not found: Nope'])
    expect(theme.dark).toEqual(GHOSTTY_DEFAULT_PALETTE)
  })

  it('an empty theme value resets an earlier one', async () => {
    const theme = await readGhosttyConfig(
      env({
        [XDG_CONFIG]: 'theme = Dracula',
        [`${HOME}/.config/ghostty/config.ghostty`]: 'theme ='
      })
    )
    expect(theme.theme).toBeNull()
    expect(theme.dark).toEqual(GHOSTTY_DEFAULT_PALETTE)
  })
})

describe('ghosttyTerminalSettings and the config read (Use Ghostty config)', () => {
  const config = [
    'theme = "Monokai Pro Machine"',
    'font-family = FiraCode Nerd Font',
    'font-size = 14',
    'font-thicken = true',
    'keybind = shift+enter=text:\\x1b\\r',
    'keybind = cmd+r=prompt_surface_title',
    'adjust-cell-height=20%',
    'window-padding-x = 10',
    'window-padding-y = 10',
    'cursor-style=bar',
    'unfocused-split-opacity = 0.5',
    'split-divider-color = #7CD5F1',
    'copy-on-select = true',
    'cursor-style-blink = true',
    'mouse-hide-while-typing = true'
  ].join('\n')

  it("maps the options Bikube has onto its settings, and notes what it can't apply", async () => {
    const read = await readGhosttyConfig(env({ [XDG_CONFIG]: config }))
    expect(read.terminal).toEqual({
      fontFamily: '"FiraCode Nerd Font", monospace',
      fontSize: 14,
      fontWeight: 500,
      cursorStyle: 'bar',
      cursorBlink: true,
      lineHeight: 1.2,
      paddingX: 10,
      paddingY: 10,
      unfocusedPaneOpacity: 0.5,
      paneDividerColor: '#7cd5f1',
      hideMouseWhileTyping: true
    })
    // Ghostty's `true` is its selection clipboard, which Bikube doesn't have.
    expect(read.problems).toContain('not applied: copy-on-select = true')
    expect(read.keybinds).toEqual(['shift+enter=text:\\x1b\\r', 'cmd+r=prompt_surface_title'])
  })

  it('keeps fonts in order, a reset starting over, and clamps values into range', () => {
    const { settings } = ghosttyTerminalSettings(
      {
        'font-size': '40.5',
        'adjust-cell-height': '-5%',
        'window-padding-x': '4,90',
        'unfocused-split-opacity': '0.05',
        'copy-on-select': 'clipboard'
      },
      ['Old', '', 'JetBrains Mono', 'Symbols']
    )
    expect(settings).toEqual({
      fontFamily: '"JetBrains Mono", Symbols, monospace',
      fontSize: 32,
      lineHeight: 1,
      paddingX: 40,
      unfocusedPaneOpacity: 0.15,
      copyOnSelect: true
    })
  })

  it('applies only while Use Ghostty config is on', async () => {
    const read = await readGhosttyConfig(env({ [XDG_CONFIG]: config }))
    expect(withGhosttyConfig(DEFAULT_SETTINGS, read)).toBe(DEFAULT_SETTINGS)
    const on = { ...DEFAULT_SETTINGS, useGhosttyConfig: true }
    expect(withGhosttyConfig(on, null)).toBe(on)
    expect(withGhosttyConfig(on, read)).toMatchObject({ fontSize: 14, cursorStyle: 'bar' })
  })
})
