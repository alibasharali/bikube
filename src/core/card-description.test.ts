import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_COUNTER_FROM,
  MAX_DESCRIPTION_LENGTH,
  checkDescription,
  descriptionLength,
  descriptionTooltip,
  normalizeDescription
} from './card-description'

describe('normalizeDescription (#69 D1)', () => {
  it('trims trailing whitespace only, and reads an empty one as none', () => {
    expect(normalizeDescription('  # Goal\nFix it \n\n')).toBe('  # Goal\nFix it')
    expect(normalizeDescription('')).toBeUndefined()
    expect(normalizeDescription(' \n\t ')).toBeUndefined()
  })
})

describe('checkDescription (#69 D1)', () => {
  it('keeps up to the cap, counting characters, and refuses a longer one, never cutting it', () => {
    expect(MAX_DESCRIPTION_LENGTH).toBe(100_000)
    const full = 'é'.repeat(MAX_DESCRIPTION_LENGTH - 1) + '😀'
    expect(descriptionLength(full)).toBe(MAX_DESCRIPTION_LENGTH)
    expect(checkDescription(full)).toEqual({ ok: true, value: full })
    expect(checkDescription(`${full}x`)).toEqual({
      ok: false,
      error: { field: 'description', message: 'Description is longer than 100,000 characters' }
    })
    // Trailing whitespace is trimmed before counting.
    expect(checkDescription(`${full}   \n`)).toEqual({ ok: true, value: full })
    expect(checkDescription(' \n')).toEqual({ ok: true, value: undefined })
  })

  it('shows its counter only past 90,000 characters', () => {
    expect(DESCRIPTION_COUNTER_FROM).toBe(90_000)
  })
})

describe('descriptionTooltip (#69 D4)', () => {
  it('is the first 5 lines, each cut at 120 characters, with … for more', () => {
    expect(descriptionTooltip('Step one\nStep two')).toBe('Step one\nStep two')
    const long = 'x'.repeat(121)
    expect(descriptionTooltip(long)).toBe(`${'x'.repeat(120)}…`)
    expect(descriptionTooltip('x'.repeat(120))).toBe('x'.repeat(120))
    expect(descriptionTooltip('1\n2\n3\n4\n5')).toBe('1\n2\n3\n4\n5')
    expect(descriptionTooltip('1\n2\n3\n4\n5\n6')).toBe('1\n2\n3\n4\n5\n…')
  })
})
