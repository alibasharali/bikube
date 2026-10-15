import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeFontFamily,
  parseSettingsFile,
  resolveTheme,
  serializeSettings,
  validateSettings
} from './settings'

describe('parseSettingsFile (#10 D7, AC8)', () => {
  it('replaces the invalid fields with defaults and keeps the valid ones', () => {
    const parsed = parseSettingsFile(
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}',
      'linux'
    )
    expect(parsed.settings).toEqual({ theme: 'system', fontSize: 13, fontFamily: 'Courier New' })
    expect(parsed.replaced).toEqual(['theme', 'fontSize'])
  })

  it('gives all defaults for a file that is not JSON', () => {
    const parsed = parseSettingsFile('not json', 'linux')
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
    expect(parsed.rejected).toBe('not JSON')
  })

  it('serializes a change to dark as exactly the expected file', () => {
    const { settings } = parseSettingsFile(
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}',
      'linux'
    )
    expect(serializeSettings({ ...settings, theme: 'dark' })).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New"}}'
    )
  })
})

describe('DEFAULT_SETTINGS (#10 D1)', () => {
  it('is System, 13 and Menlo, Consolas, monospace', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'system',
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace'
    })
  })
})

describe('parseSettingsFile, the rest of D7', () => {
  const file = (settings: unknown, version: unknown = 1): string =>
    JSON.stringify({ version, settings })

  it('keeps a fully valid file as it is', () => {
    const parsed = parseSettingsFile(
      file({ theme: 'light', fontSize: 16, fontFamily: 'Courier New, monospace' }),
      'linux'
    )
    expect(parsed).toEqual({
      settings: { theme: 'light', fontSize: 16, fontFamily: 'Courier New, monospace' },
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
    expect(parsed.settings).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo' })
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
      const parsed = parseSettingsFile(file({ theme: 'dark', fontSize: 13, fontFamily }), 'linux')
      expect(parsed.settings.fontFamily).toBe('Menlo, Consolas, monospace')
      expect(parsed.replaced).toEqual(['fontFamily'])
    }
  )

  it('trims the family, and keeps 200 chars after trimming', () => {
    const long = 'a'.repeat(200)
    expect(
      parseSettingsFile(file({ theme: 'dark', fontSize: 13, fontFamily: `  ${long}  ` }), 'linux')
        .settings.fontFamily
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
        { theme: 'light', fontSize: 16, fontFamily: ' Courier New ', extra: 1 },
        'linux'
      )
    ).toEqual({ theme: 'light', fontSize: 16, fontFamily: 'Courier New' })
  })

  it.each([
    null,
    [],
    { theme: 'neon', fontSize: 13, fontFamily: '' },
    { theme: 'dark', fontSize: 40, fontFamily: '' },
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
    expect(parsed.settings).toEqual({ theme: 'dark', fontSize: 16, fontFamily: 'Menlo' })
    expect(parsed.syncFolder).toBe('/Users/me/Sync')
  })

  it('loads a #10 file without syncFolder with sync off and its theme and font kept', () => {
    const parsed = parseSettingsFile(
      file({ theme: 'light', fontSize: 18, fontFamily: 'Courier New' }),
      'linux'
    )
    expect(parsed.settings).toEqual({ theme: 'light', fontSize: 18, fontFamily: 'Courier New' })
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
      expect(parsed.settings).toEqual({ theme: 'dark', fontSize: 16, fontFamily: 'Menlo' })
    }
  )

  it('writes syncFolder after the font family, and leaves it out when off', () => {
    const settings = { theme: 'dark' as const, fontSize: 13, fontFamily: 'Menlo' }
    expect(serializeSettings(settings, '/Users/me/Sync')).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","syncFolder":"/Users/me/Sync"}}'
    )
    expect(serializeSettings(settings, null)).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo"}}'
    )
  })

  it('never takes syncFolder from a settings:save payload', () => {
    expect(
      validateSettings(
        { theme: 'dark', fontSize: 13, fontFamily: 'Menlo', syncFolder: '/x' },
        'linux'
      )
    ).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo' })
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
    expect(parsed.settings).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo' })
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
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shortcuts":{"splitRight":"Ctrl+Alt+R"},"syncFolder":"/Sync"}}'
    )
    expect(serializeSettings({ ...parsed.settings, shortcuts: {} })).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo"}}'
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
    const base = { theme: 'dark', fontSize: 13, fontFamily: 'Menlo' }
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
