import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_FAMILY } from './settings'
import { FONT_SIZE_ERROR, fontFamilyField, parseFontSize } from './settings-form'

describe('parseFontSize (#10 D5, AC5)', () => {
  it('reads a whole number from 8 to 32', () => {
    expect(parseFontSize('18')).toBe(18)
    expect(parseFontSize('8')).toBe(8)
    expect(parseFontSize('32')).toBe(32)
    expect(parseFontSize(' 16 ')).toBe(16)
  })

  it('rejects out of range, fractional, non-numeric and empty text', () => {
    for (const text of ['40', '7', '12.5', 'abc', '', ' ', '1e1', '-13', '0x10', '+13']) {
      expect(parseFontSize(text), text).toBeNull()
    }
  })

  it('has the message the dialog shows', () => {
    expect(FONT_SIZE_ERROR).toBe('Font size must be a whole number from 8 to 32')
  })
})

describe('fontFamilyField (#10 D5, AC2, AC6)', () => {
  it('is empty for the default family, so the placeholder shows', () => {
    expect(fontFamilyField(DEFAULT_FONT_FAMILY)).toBe('')
  })

  it('is the family otherwise', () => {
    expect(fontFamilyField('Courier New, monospace')).toBe('Courier New, monospace')
  })
})
