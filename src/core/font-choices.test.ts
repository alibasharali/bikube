import { describe, expect, it } from 'vitest'
import { FONT_CHOICES, familyOf, fontChoiceOf } from './font-choices'
import { DEFAULT_FONT_FAMILY } from './settings'

describe('font choices', () => {
  it('saves a listed font as itself, then monospace, and reads it back', () => {
    expect(familyOf('JetBrains Mono')).toBe('"JetBrains Mono", monospace')
    for (const name of FONT_CHOICES) {
      expect(fontChoiceOf(familyOf(name))).toEqual({ kind: 'font', name })
    }
  })

  it('reads the default family as the default', () => {
    expect(fontChoiceOf(DEFAULT_FONT_FAMILY)).toEqual({ kind: 'default' })
  })

  it('reads anything else as custom, a listed name typed another way included', () => {
    expect(fontChoiceOf('Courier New, monospace')).toEqual({ kind: 'custom' })
    expect(fontChoiceOf('"Comic Mono", monospace')).toEqual({ kind: 'custom' })
    expect(fontChoiceOf('"Fira Code"')).toEqual({ kind: 'custom' })
  })
})
