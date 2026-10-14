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
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}'
    )
    expect(parsed.settings).toEqual({ theme: 'system', fontSize: 13, fontFamily: 'Courier New' })
    expect(parsed.replaced).toEqual(['theme', 'fontSize'])
  })

  it('gives all defaults for a file that is not JSON', () => {
    const parsed = parseSettingsFile('not json')
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
    expect(parsed.rejected).toBe('not JSON')
  })

  it('serializes a change to dark as exactly the expected file', () => {
    const { settings } = parseSettingsFile(
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}'
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
      file({ theme: 'light', fontSize: 16, fontFamily: 'Courier New, monospace' })
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
    expect(parseSettingsFile(text)).toEqual({
      settings: DEFAULT_SETTINGS,
      replaced: [],
      rejected: 'not an object'
    })
  })

  it.each([2, 0, '1', null])('gives all defaults for version %j', (version) => {
    const parsed = parseSettingsFile(file({ theme: 'dark' }, version))
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
    expect(parsed.rejected).toBe('unsupported version')
  })

  it('gives all defaults when the version is missing', () => {
    expect(parseSettingsFile('{"settings":{"theme":"dark"}}').settings).toEqual(DEFAULT_SETTINGS)
  })

  it('gives defaults for every missing field', () => {
    expect(parseSettingsFile(file({ theme: 'dark' }))).toEqual({
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
      replaced: ['fontSize', 'fontFamily']
    })
    expect(parseSettingsFile('{"version":1}').replaced).toEqual(['theme', 'fontSize', 'fontFamily'])
  })

  it.each([7, 33, 12.5, '13', null])('replaces font size %j with 13', (fontSize) => {
    const parsed = parseSettingsFile(file({ theme: 'dark', fontSize, fontFamily: 'Menlo' }))
    expect(parsed.settings).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo' })
    expect(parsed.replaced).toEqual(['fontSize'])
  })

  it.each([8, 32])('keeps font size %d at the edge of the range', (fontSize) => {
    expect(
      parseSettingsFile(file({ theme: 'dark', fontSize, fontFamily: 'x' })).settings.fontSize
    ).toBe(fontSize)
  })

  it.each(['Dark', '', 1])('replaces theme %j with system', (theme) => {
    expect(parseSettingsFile(file({ theme, fontSize: 13, fontFamily: 'x' })).settings.theme).toBe(
      'system'
    )
  })

  it.each([42, 'a'.repeat(201), 'Menlo\nEvil', 'Menlo\u0007'])(
    'replaces font family %j with the default',
    (fontFamily) => {
      const parsed = parseSettingsFile(file({ theme: 'dark', fontSize: 13, fontFamily }))
      expect(parsed.settings.fontFamily).toBe('Menlo, Consolas, monospace')
      expect(parsed.replaced).toEqual(['fontFamily'])
    }
  )

  it('trims the family, and keeps 200 chars after trimming', () => {
    const long = 'a'.repeat(200)
    expect(
      parseSettingsFile(file({ theme: 'dark', fontSize: 13, fontFamily: `  ${long}  ` })).settings
        .fontFamily
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
      validateSettings({ theme: 'light', fontSize: 16, fontFamily: ' Courier New ', extra: 1 })
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
    expect(validateSettings(value)).toBeNull()
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
