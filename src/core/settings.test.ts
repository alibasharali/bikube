import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeFontFamily,
  parseSettingsFile,
  resolveTheme,
  serializeSettings,
  validateSettings,
  PREFERENCE_DEFAULTS,
  type Settings
} from './settings'

/** The settings after #10's three, at their defaults. */
const NEW_FIELDS = {
  shell: '',
  terminalThemeDark: 'Bikube Dark',
  terminalThemeLight: 'Bikube Light',
  useGhosttyTheme: false,
  ...PREFERENCE_DEFAULTS
}

describe('parseSettingsFile (#10 D7, AC8)', () => {
  it('replaces the invalid fields with defaults and keeps the valid ones', () => {
    const parsed = parseSettingsFile(
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}',
      'linux'
    )
    expect(parsed.settings).toEqual({
      theme: 'system',
      fontSize: 13,
      fontFamily: 'Courier New',
      ...NEW_FIELDS
    })
    expect(parsed.replaced).toEqual(['theme', 'fontSize'])
  })

  it('gives all defaults for a file that is not JSON', () => {
    const parsed = parseSettingsFile('not json', 'linux')
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
    expect(parsed.rejected).toBe('not JSON')
  })

  it('serializes a change to dark as exactly the expected file', () => {
    const { settings } = parseSettingsFile(
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}',
      'linux'
    )
    expect(serializeSettings({ ...settings, theme: 'dark' })).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
    )
  })
})

describe('DEFAULT_SETTINGS (#10 D1)', () => {
  it('is System, 13 and Menlo, Consolas, monospace', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'system',
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace',
      ...NEW_FIELDS
    })
  })
})

describe('parseSettingsFile, the rest of D7', () => {
  const file = (settings: unknown, version: unknown = 1): string =>
    JSON.stringify({ version, settings })

  it('keeps a fully valid file as it is', () => {
    const parsed = parseSettingsFile(
      file({ theme: 'light', fontSize: 16, fontFamily: 'Courier New, monospace', ...NEW_FIELDS }),
      'linux'
    )
    expect(parsed).toEqual({
      settings: {
        theme: 'light',
        fontSize: 16,
        fontFamily: 'Courier New, monospace',
        ...NEW_FIELDS
      },
      replaced: []
    })
  })

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '3']
  ])('gives all defaults for %s', (_, text) => {
    expect(parseSettingsFile(text, 'linux')).toEqual({
      settings: DEFAULT_SETTINGS,
      replaced: [],
      rejected: 'not an object'
    })
  })

  it.each([2, 0, '1', null])('gives all defaults for version %j', (version) => {
    const parsed = parseSettingsFile(file({ theme: 'dark' }, version), 'linux')
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
    expect(parsed.rejected).toBe('unsupported version')
  })

  it('gives all defaults when the version is missing', () => {
    expect(parseSettingsFile('{"settings":{"theme":"dark"}}', 'linux').settings).toEqual(
      DEFAULT_SETTINGS
    )
  })

  it('gives defaults for every missing field', () => {
    expect(parseSettingsFile(file({ theme: 'dark' }), 'linux')).toEqual({
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
      replaced: ['fontSize', 'fontFamily']
    })
    expect(parseSettingsFile('{"version":1}', 'linux').replaced).toEqual([
      'theme',
      'fontSize',
      'fontFamily'
    ])
  })

  it.each([7, 33, 12.5, '13', null])('replaces font size %j with 13', (fontSize) => {
    const parsed = parseSettingsFile(
      file({ theme: 'dark', fontSize, fontFamily: 'Menlo' }),
      'linux'
    )
    expect(parsed.settings).toEqual({
      theme: 'dark',
      fontSize: 13,
      fontFamily: 'Menlo',
      ...NEW_FIELDS
    })
    expect(parsed.replaced).toEqual(['fontSize'])
  })

  it.each([8, 32])('keeps font size %d at the edge of the range', (fontSize) => {
    expect(
      parseSettingsFile(file({ theme: 'dark', fontSize, fontFamily: 'x' }), 'linux').settings
        .fontSize
    ).toBe(fontSize)
  })

  it.each(['Dark', '', 1])('replaces theme %j with system', (theme) => {
    expect(
      parseSettingsFile(file({ theme, fontSize: 13, fontFamily: 'x' }), 'linux').settings.theme
    ).toBe('system')
  })

  it.each([42, 'a'.repeat(201), 'Menlo\nEvil', 'Menlo\u0007'])(
    'replaces font family %j with the default',
    (fontFamily) => {
      const parsed = parseSettingsFile(
        file({ theme: 'dark', fontSize: 13, fontFamily, ...NEW_FIELDS }),
        'linux'
      )
      expect(parsed.settings.fontFamily).toBe('Menlo, Consolas, monospace')
      expect(parsed.replaced).toEqual(['fontFamily'])
    }
  )

  it('trims the family, and keeps 200 chars after trimming', () => {
    const long = 'a'.repeat(200)
    expect(
      parseSettingsFile(
        file({ theme: 'dark', fontSize: 13, fontFamily: `  ${long}  `, ...NEW_FIELDS }),
        'linux'
      ).settings.fontFamily
    ).toBe(long)
  })
})

describe('normalizeFontFamily (#10 D4)', () => {
  it('trims the family as typed', () => {
    expect(normalizeFontFamily('  Courier New, monospace  ')).toBe('Courier New, monospace')
  })

  it.each(['', '   ', '\t '])('gives the default for the empty family %j', (value) => {
    expect(normalizeFontFamily(value)).toBe('Menlo, Consolas, monospace')
  })

  it('rejects control characters inside the family', () => {
    expect(normalizeFontFamily('Menlo\u001bX')).toBeNull()
  })
})

describe('validateSettings (#10 D6)', () => {
  it('accepts valid settings, keeping only D1 fields and normalizing the family', () => {
    expect(
      validateSettings(
        {
          theme: 'light',
          fontSize: 16,
          fontFamily: ' Courier New ',
          ...NEW_FIELDS,
          extra: 1
        },
        'linux'
      )
    ).toEqual({ theme: 'light', fontSize: 16, fontFamily: 'Courier New', ...NEW_FIELDS })
  })

  it.each([
    null,
    [],
    { theme: 'neon', fontSize: 13, fontFamily: '', ...NEW_FIELDS },
    { theme: 'dark', fontSize: 40, fontFamily: '', ...NEW_FIELDS },
    { theme: 'dark', fontSize: 13, fontFamily: 'a'.repeat(201) },
    { theme: 'dark', fontSize: 13 }
  ])('rejects %j', (value) => {
    expect(validateSettings(value, 'linux')).toBeNull()
  })
})

describe('resolveTheme (#10 D2)', () => {
  it('follows the OS appearance for system and ignores it otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('syncFolder in the settings file (#13 D10, AC12)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })

  it('keeps an absolute syncFolder next to the other fields', () => {
    const parsed = parseSettingsFile(
      file({ theme: 'dark', fontSize: 16, fontFamily: 'Menlo', syncFolder: '/Users/me/Sync' }),
      'linux'
    )
    expect(parsed.settings).toEqual({
      theme: 'dark',
      fontSize: 16,
      fontFamily: 'Menlo',
      ...NEW_FIELDS
    })
    expect(parsed.syncFolder).toBe('/Users/me/Sync')
  })

  it('loads a #10 file without syncFolder with sync off and its theme and font kept', () => {
    const parsed = parseSettingsFile(
      file({ theme: 'light', fontSize: 18, fontFamily: 'Courier New', ...NEW_FIELDS }),
      'linux'
    )
    expect(parsed.settings).toEqual({
      theme: 'light',
      fontSize: 18,
      fontFamily: 'Courier New',
      ...NEW_FIELDS
    })
    expect(parsed.syncFolder).toBeUndefined()
    expect(parsed.replaced).toEqual([])
  })

  it.each([42, '', 'relative/dir', '~/Sync', '/a\0b', null, `/${'a'.repeat(5000)}`])(
    'loads syncFolder %j as off, keeping the other fields',
    (syncFolder) => {
      const parsed = parseSettingsFile(
        file({ theme: 'dark', fontSize: 16, fontFamily: 'Menlo', syncFolder }),
        'linux'
      )
      expect(parsed.syncFolder).toBeUndefined()
      expect(parsed.settings).toEqual({
        theme: 'dark',
        fontSize: 16,
        fontFamily: 'Menlo',
        ...NEW_FIELDS
      })
    }
  )

  it('writes syncFolder after the font family, and leaves it out when off', () => {
    const settings = { theme: 'dark' as const, fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }
    expect(serializeSettings(settings, '/Users/me/Sync')).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false,"syncFolder":"/Users/me/Sync"}}'
    )
    expect(serializeSettings(settings, null)).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
    )
  })

  it('never takes syncFolder from a settings:save payload', () => {
    expect(
      validateSettings(
        {
          theme: 'dark',
          fontSize: 13,
          fontFamily: 'Menlo',
          ...NEW_FIELDS,
          syncFolder: '/x'
        },
        'linux'
      )
    ).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS })
  })
})

describe('shell and terminal colours in the settings file', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo' }

  it('gives a file from before them their defaults, without counting them as replaced', () => {
    const parsed = parseSettingsFile(file(base), 'linux')
    expect(parsed.settings).toEqual({ ...base, ...NEW_FIELDS })
    expect(parsed.replaced).toEqual([])
  })

  it('keeps valid values', () => {
    const fields = {
      shell: '/opt/homebrew/bin/fish',
      terminalThemeDark: 'Catppuccin Mocha',
      terminalThemeLight: 'Catppuccin Latte',
      useGhosttyTheme: true
    }
    expect(parseSettingsFile(file({ ...base, ...fields }), 'linux').settings).toEqual({
      ...base,
      ...fields,
      ...PREFERENCE_DEFAULTS
    })
  })

  it('replaces invalid values with their defaults', () => {
    const parsed = parseSettingsFile(
      file({
        ...base,
        shell: 'fish',
        terminalThemeDark: 'No Such Theme',
        terminalThemeLight: 7,
        useGhosttyTheme: 'yes'
      }),
      'linux'
    )
    expect(parsed.settings).toEqual({ ...base, ...NEW_FIELDS })
    expect(parsed.replaced).toEqual([
      'shell',
      'terminalThemeDark',
      'terminalThemeLight',
      'useGhosttyTheme'
    ])
  })

  it.each(['fish', 'bin/fish', '/bin/fi\nsh', 'x'.repeat(10)])(
    'refuses a save with shell %j',
    (shell) => {
      expect(validateSettings({ ...base, ...NEW_FIELDS, shell }, 'linux')).toBeNull()
    }
  )

  it('refuses a save missing the new fields', () => {
    expect(validateSettings(base, 'linux')).toBeNull()
  })
})

describe('shortcuts in the settings file (#31 D9, AC8)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })

  it('reads each shortcut on its own and keeps the theme', () => {
    const parsed = parseSettingsFile(
      file({
        theme: 'dark',
        fontSize: 13,
        fontFamily: 'Menlo',
        shortcuts: { back: 'B', splitRight: 'Ctrl+Alt+R', closePane: 'Ctrl+Alt+R', bogus: 'Ctrl+K' }
      }),
      'linux'
    )
    expect(parsed.settings).toEqual({
      theme: 'dark',
      fontSize: 13,
      fontFamily: 'Menlo',
      ...NEW_FIELDS
    })
    expect(parsed.settings.shortcuts).toBeUndefined()
    expect(parsed.replaced).toEqual(['shortcuts'])
  })

  it('keeps the shortcuts that differ from the default and writes only those', () => {
    const parsed = parseSettingsFile(
      file({
        theme: 'dark',
        fontSize: 13,
        fontFamily: 'Menlo',
        shortcuts: { splitRight: 'Ctrl+Alt+R', back: 'Ctrl+Shift+B' }
      }),
      'linux'
    )
    expect(parsed.settings.shortcuts).toEqual({ splitRight: 'Ctrl+Alt+R' })
    expect(parsed.replaced).toEqual([])
    expect(serializeSettings(parsed.settings, '/Sync')).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false,"shortcuts":{"splitRight":"Ctrl+Alt+R"},"syncFolder":"/Sync"}}'
    )
    expect(serializeSettings({ ...parsed.settings, shortcuts: {} })).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
    )
  })

  it('reads the defaults of the OS it runs on', () => {
    const parsed = parseSettingsFile(
      file({
        theme: 'dark',
        fontSize: 13,
        fontFamily: 'Menlo',
        shortcuts: { splitRight: 'Cmd+D' }
      }),
      'darwin'
    )
    expect(parsed.settings.shortcuts).toBeUndefined()
  })

  it('saves a valid set and rejects the whole save for a bad one', () => {
    const base = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }
    expect(
      validateSettings(
        { ...base, shortcuts: { splitRight: 'Ctrl+Alt+R', back: 'Ctrl+Shift+B' } },
        'linux'
      )
    ).toEqual({ ...base, shortcuts: { splitRight: 'Ctrl+Alt+R' } })
    expect(validateSettings({ ...base, shortcuts: {} }, 'linux')).toEqual(base)
    expect(validateSettings({ ...base, shortcuts: { back: 'B' } }, 'linux')).toBeNull()
    expect(
      validateSettings({ ...base, shortcuts: { back: 'Ctrl+K', closeCard: 'Ctrl+K' } }, 'linux')
    ).toBeNull()
  })
})

describe('terminal and notification preferences in the settings file', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('writes only the preferences that differ from their defaults, in a fixed order', () => {
    const settings: Settings = {
      ...base,
      cursorStyle: 'bar',
      lineHeight: 1.2,
      notifications: false
    }
    const written = JSON.parse(serializeSettings(settings)).settings
    expect(Object.keys(written).slice(7)).toEqual(['cursorStyle', 'lineHeight', 'notifications'])
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('cursorStyle')
  })

  it('reads written preferences back, and missing ones as their defaults', () => {
    const parsed = parseSettingsFile(
      file({ ...base, scrollback: 50000, bell: 'flash', fontWeight: 500 }),
      'linux'
    )
    expect(parsed.settings).toMatchObject({
      scrollback: 50000,
      bell: 'flash',
      fontWeight: 500,
      cursorBlink: false
    })
    expect(parsed.replaced).toEqual([])
  })

  it('replaces invalid preferences with their defaults', () => {
    const parsed = parseSettingsFile(
      file({
        ...base,
        scrollback: 7,
        lineHeight: 1.25,
        letterSpacing: 9,
        fontWeight: 450,
        cursorStyle: 'beam'
      }),
      'linux'
    )
    expect(parsed.settings).toMatchObject({
      scrollback: 10000,
      lineHeight: 1,
      letterSpacing: 0,
      fontWeight: 400,
      cursorStyle: 'block'
    })
    expect(parsed.replaced).toEqual([
      'cursorStyle',
      'scrollback',
      'lineHeight',
      'letterSpacing',
      'fontWeight'
    ])
  })

  it('accepts line heights in tenths from 1 to 2', () => {
    for (const lineHeight of [1, 1.1, 1.5, 2]) {
      expect(validateSettings({ ...base, lineHeight }, 'linux')?.lineHeight).toBe(lineHeight)
    }
    for (const lineHeight of [0.9, 2.1, 1.05]) {
      expect(validateSettings({ ...base, lineHeight }, 'linux')).toBeNull()
    }
  })

  it('refuses a save with an invalid preference, and fills missing ones with defaults', () => {
    expect(validateSettings({ ...base, bell: 'loud' }, 'linux')).toBeNull()
    expect(validateSettings(base, 'linux')).toMatchObject(PREFERENCE_DEFAULTS)
  })
})

describe('the side panel preferences (#55 D3, D4)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('shows the panel 280 px wide by default, and writes neither while default', () => {
    expect(DEFAULT_SETTINGS.sidePanelOpen).toBe(true)
    expect(DEFAULT_SETTINGS.sidePanelWidth).toBe(280)
    const written = JSON.parse(serializeSettings(base)).settings
    expect(written).not.toHaveProperty('sidePanelOpen')
    expect(written).not.toHaveProperty('sidePanelWidth')
  })

  it('writes a hidden panel and another width, and reads them back', () => {
    const settings = { ...base, sidePanelOpen: false, sidePanelWidth: 400 }
    const text = serializeSettings(settings)
    expect(JSON.parse(text).settings).toMatchObject({ sidePanelOpen: false, sidePanelWidth: 400 })
    const parsed = parseSettingsFile(text, 'linux')
    expect(parsed.settings).toEqual(settings)
    expect(parsed.replaced).toEqual([])
  })

  it('takes widths from 200 to 4000 whole pixels and reports any other value', () => {
    for (const sidePanelWidth of [200, 4000]) {
      expect(validateSettings({ ...base, sidePanelWidth }, 'linux')?.sidePanelWidth).toBe(
        sidePanelWidth
      )
    }
    for (const sidePanelWidth of [199, 4001, 280.5, '280']) {
      expect(validateSettings({ ...base, sidePanelWidth }, 'linux')).toBeNull()
    }
    const parsed = parseSettingsFile(
      file({ ...base, sidePanelWidth: 100, sidePanelOpen: 'no' }),
      'linux'
    )
    expect(parsed.settings).toMatchObject({ sidePanelOpen: true, sidePanelWidth: 280 })
    expect(parsed.replaced).toEqual(['sidePanelOpen', 'sidePanelWidth'])
  })
})

describe('the editor preferences (#55 D14)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('opens files with VS Code by default, and writes neither field while default', () => {
    expect(DEFAULT_SETTINGS.editor).toBe('vscode')
    expect(DEFAULT_SETTINGS.editorCommand).toBe('')
    const written = JSON.parse(serializeSettings(base)).settings
    expect(written).not.toHaveProperty('editor')
    expect(written).not.toHaveProperty('editorCommand')
  })

  it('writes a custom command and reads it back', () => {
    const settings: Settings = { ...base, editor: 'custom', editorCommand: 'fake-editor --wait' }
    const text = serializeSettings(settings)
    expect(JSON.parse(text).settings).toMatchObject({
      editor: 'custom',
      editorCommand: 'fake-editor --wait'
    })
    expect(parseSettingsFile(text, 'linux')).toEqual({ settings, replaced: [] })
  })

  it('takes each editor and a one-line command, and reads any other value as the default', () => {
    for (const editor of ['vscode', 'cursor', 'zed', 'system', 'custom']) {
      expect(validateSettings({ ...base, editor }, 'linux')?.editor).toBe(editor)
    }
    for (const editorCommand of ['two\nlines', 'x'.repeat(4097), 3]) {
      expect(validateSettings({ ...base, editorCommand }, 'linux')).toBeNull()
    }
    const parsed = parseSettingsFile(file({ ...base, editor: 'vim', editorCommand: 7 }), 'linux')
    expect(parsed.settings).toMatchObject({ editor: 'vscode', editorCommand: '' })
    expect(parsed.replaced).toEqual(['editor', 'editorCommand'])
  })
})

describe('the Shell integration preference (#45 D4)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('is on by default and not written while on', () => {
    expect(DEFAULT_SETTINGS.shellIntegration).toBe(true)
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('shellIntegration')
    expect(parseSettingsFile(file(base), 'linux').settings.shellIntegration).toBe(true)
  })

  it('is written as false when off and read back', () => {
    const settings: Settings = { ...base, shellIntegration: false }
    const text = serializeSettings(settings)
    expect(JSON.parse(text).settings.shellIntegration).toBe(false)
    expect(parseSettingsFile(text, 'linux')).toEqual({ settings, replaced: [] })
  })

  it('takes only a boolean', () => {
    expect(validateSettings({ ...base, shellIntegration: false }, 'linux')?.shellIntegration).toBe(
      false
    )
    expect(validateSettings({ ...base, shellIntegration: 'no' }, 'linux')).toBeNull()
    const parsed = parseSettingsFile(file({ ...base, shellIntegration: 0 }), 'linux')
    expect(parsed.settings.shellIntegration).toBe(true)
    expect(parsed.replaced).toEqual(['shellIntegration'])
  })
})

describe('the Inline images preference (#52 D3, AC1)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('reads true without the key, and saving true writes none', () => {
    const without: Partial<Settings> = { ...base }
    delete without.inlineImages
    expect(DEFAULT_SETTINGS.inlineImages).toBe(true)
    expect(parseSettingsFile(file(without), 'linux').settings.inlineImages).toBe(true)
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('inlineImages')
  })

  it('reads false from the file, and saving false writes it', () => {
    const settings: Settings = { ...base, inlineImages: false }
    const text = serializeSettings(settings)
    expect(JSON.parse(text).settings.inlineImages).toBe(false)
    expect(parseSettingsFile(file(settings), 'linux')).toEqual({ settings, replaced: [] })
  })

  it('reads a non-boolean value as the default true', () => {
    const parsed = parseSettingsFile(file({ ...base, inlineImages: 'off' }), 'linux')
    expect(parsed.settings.inlineImages).toBe(true)
    expect(parsed.replaced).toEqual(['inlineImages'])
  })
})

describe('the Keep output preference (#46 D8)', () => {
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('is on by default and written only when off, as "keepOutput": false', () => {
    expect(DEFAULT_SETTINGS.keepOutput).toBe(true)
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('keepOutput')
    const text = serializeSettings({ ...base, keepOutput: false })
    expect(JSON.parse(text).settings.keepOutput).toBe(false)
    expect(parseSettingsFile(text, 'linux').settings.keepOutput).toBe(false)
  })

  it('refuses a value that is not a boolean', () => {
    expect(validateSettings({ ...base, keepOutput: 'no' }, 'linux')).toBeNull()
  })
})

describe('the global shortcut in the settings file (#51 D9, AC8)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('is none by default and written only when set', () => {
    expect(DEFAULT_SETTINGS.globalShortcut).toBeUndefined()
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('globalShortcut')
    const settings: Settings = { ...base, globalShortcut: 'Ctrl+Alt+Shift+D' }
    const text = serializeSettings(settings)
    expect(JSON.parse(text).settings.globalShortcut).toBe('Ctrl+Alt+Shift+D')
    expect(parseSettingsFile(text, 'linux')).toEqual({ settings, replaced: [] })
  })

  it('reads a key alone, an in-app shortcut, a fixed one or a non-string as none, reported', () => {
    for (const value of ['D', 'Ctrl+Shift+P', 'Ctrl+Shift+C', 'Ctrl+MediaPlayPause', 42]) {
      const parsed = parseSettingsFile(file({ ...base, globalShortcut: value }), 'linux')
      expect(parsed.settings).toEqual(base)
      expect(parsed.replaced).toEqual(['globalShortcut'])
    }
  })

  it('checks it against the in-app shortcuts as read, and the OS it runs on', () => {
    // The palette moved away, so its default is free.
    const moved = parseSettingsFile(
      file({ ...base, shortcuts: { palette: 'Ctrl+Alt+P' }, globalShortcut: 'Ctrl+Shift+P' }),
      'linux'
    )
    expect(moved.settings.globalShortcut).toBe('Ctrl+Shift+P')
    // A bad override falls back to the default, which then holds it.
    const fellBack = parseSettingsFile(
      file({ ...base, shortcuts: { palette: 'P' }, globalShortcut: 'Ctrl+Shift+P' }),
      'linux'
    )
    expect(fellBack.settings.globalShortcut).toBeUndefined()
    expect(fellBack.replaced).toEqual(['shortcuts', 'globalShortcut'])
    expect(
      parseSettingsFile(file({ ...base, globalShortcut: 'Cmd+K' }), 'darwin').settings
        .globalShortcut
    ).toBeUndefined()
  })

  it('saves a valid one and refuses a save with an invalid one', () => {
    expect(validateSettings({ ...base, globalShortcut: 'Ctrl+Alt+Shift+D' }, 'linux')).toEqual({
      ...base,
      globalShortcut: 'Ctrl+Alt+Shift+D'
    })
    expect(validateSettings({ ...base, globalShortcut: undefined }, 'linux')).toEqual(base)
    for (const value of ['D', 'Ctrl+Shift+P', 'Ctrl+Shift+C', 'Ctrl+MediaPlayPause', 42, '']) {
      expect(validateSettings({ ...base, globalShortcut: value }, 'linux')).toBeNull()
    }
    // An in-app shortcut taking it is refused too.
    expect(
      validateSettings(
        { ...base, globalShortcut: 'Ctrl+Alt+R', shortcuts: { splitRight: 'Ctrl+Alt+R' } },
        'linux'
      )
    ).toBeNull()
  })
})

describe('the Open the next waiting card preference (#51 D9, AC8)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('is on by default and written only when off', () => {
    expect(DEFAULT_SETTINGS.openWaitingOnShow).toBe(true)
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('openWaitingOnShow')
    const text = serializeSettings({ ...base, openWaitingOnShow: false })
    expect(JSON.parse(text).settings.openWaitingOnShow).toBe(false)
    expect(parseSettingsFile(text, 'linux').settings.openWaitingOnShow).toBe(false)
  })

  it('reads a value that is not a boolean as on, and refuses it in a save', () => {
    const parsed = parseSettingsFile(file({ ...base, openWaitingOnShow: 'no' }), 'linux')
    expect(parsed.settings.openWaitingOnShow).toBe(true)
    expect(parsed.replaced).toEqual(['openWaitingOnShow'])
    expect(validateSettings({ ...base, openWaitingOnShow: 'no' }, 'linux')).toBeNull()
  })
})

describe('the App theme preference (#64 D10, AC2)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('reads Default when missing, and a known theme as itself', () => {
    expect(parseSettingsFile(file({ theme: 'dark' }), 'linux').settings.appTheme).toBe('default')
    expect(parseSettingsFile(file({ ...base, appTheme: 'nord' }), 'linux').settings.appTheme).toBe(
      'nord'
    )
  })

  it('reads an unknown or invalid value as Default, and refuses it in a save', () => {
    for (const value of ['solarized', 42]) {
      const parsed = parseSettingsFile(file({ ...base, appTheme: value }), 'linux')
      expect(parsed.settings.appTheme).toBe('default')
      expect(parsed.replaced).toEqual(['appTheme'])
      expect(validateSettings({ ...base, appTheme: value }, 'linux')).toBeNull()
    }
  })

  it('writes no key for Default and the id for another theme', () => {
    expect(
      JSON.parse(serializeSettings({ ...base, appTheme: 'default' })).settings
    ).not.toHaveProperty('appTheme')
    const text = serializeSettings({ ...base, appTheme: 'gruvbox' })
    expect(JSON.parse(text).settings.appTheme).toBe('gruvbox')
    expect(parseSettingsFile(text, 'linux').settings.appTheme).toBe('gruvbox')
  })
})

describe('the App font preference (#66 D7, AC8)', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('is the system UI font by default, and writes no key for it', () => {
    expect(DEFAULT_SETTINGS.appFontFamily).toBe('')
    expect(parseSettingsFile(file({ theme: 'dark' }), 'linux').settings.appFontFamily).toBe('')
    expect(JSON.parse(serializeSettings(base)).settings).not.toHaveProperty('appFontFamily')
  })

  it('writes a family and reads it back', () => {
    const appFontFamily = '"Inter", system-ui, sans-serif'
    const text = serializeSettings({ ...base, appFontFamily })
    expect(JSON.parse(text).settings.appFontFamily).toBe(appFontFamily)
    expect(parseSettingsFile(text, 'linux').settings.appFontFamily).toBe(appFontFamily)
    expect(
      validateSettings({ ...base, appFontFamily: 'Courier New' }, 'linux')?.appFontFamily
    ).toBe('Courier New')
  })

  it('refuses a family that is untrimmed, too long, holds control chars or is no string', () => {
    for (const value of [' Inter', 'x'.repeat(201), 'In\nter', 3]) {
      expect(validateSettings({ ...base, appFontFamily: value }, 'linux')).toBeNull()
      const parsed = parseSettingsFile(file({ ...base, appFontFamily: value }), 'linux')
      expect(parsed.settings.appFontFamily).toBe('')
      expect(parsed.replaced).toEqual(['appFontFamily'])
    }
    expect(validateSettings({ ...base, appFontFamily: 'x'.repeat(200) }, 'linux')).not.toBeNull()
  })
})

describe('the default view and the view prompt preferences', () => {
  const file = (settings: unknown): string => JSON.stringify({ version: 1, settings })
  const base: Settings = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS }

  it('default to Kanban and not chosen, writing no keys for them', () => {
    const read = parseSettingsFile(file({ theme: 'dark' }), 'linux').settings
    expect([read.defaultView, read.viewChosen]).toEqual(['kanban', false])
    const written = JSON.parse(serializeSettings(base)).settings
    expect(written).not.toHaveProperty('defaultView')
    expect(written).not.toHaveProperty('viewChosen')
  })

  it('write Grid and a chosen view, and read them back', () => {
    const text = serializeSettings({ ...base, defaultView: 'grid', viewChosen: true })
    expect(JSON.parse(text).settings).toMatchObject({ defaultView: 'grid', viewChosen: true })
    const read = parseSettingsFile(text, 'linux').settings
    expect([read.defaultView, read.viewChosen]).toEqual(['grid', true])
  })

  it('refuse an unknown view', () => {
    expect(validateSettings({ ...base, defaultView: 'list' }, 'linux')).toBeNull()
    const parsed = parseSettingsFile(file({ ...base, defaultView: 'list' }), 'linux')
    expect(parsed.settings.defaultView).toBe('kanban')
    expect(parsed.replaced).toEqual(['defaultView'])
  })
})
