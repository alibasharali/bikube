import { describe, expect, it } from 'vitest'
import { FIND_HIGHLIGHT_LIMIT, findResultText, isValidRegex } from './find'

describe('findResultText (#35 D7)', () => {
  it('reads the active match counted from the top, of the matches in the buffer', () => {
    expect(findResultText({ count: 3, index: 2 })).toBe('3 of 3')
    expect(findResultText({ count: 3, index: 0 })).toBe('1 of 3')
    expect(findResultText({ count: 1, index: 0 })).toBe('1 of 1')
  })

  it('reads No results when nothing matches', () => {
    expect(findResultText({ count: 0, index: -1 })).toBe('No results')
  })

  it('reads More than 1,000 past the highlight limit, where the active match is unknown', () => {
    expect(FIND_HIGHLIGHT_LIMIT).toBe(1000)
    expect(findResultText({ count: 1000, index: -1 })).toBe('More than 1,000')
    expect(findResultText({ count: 1001, index: 4 })).toBe('More than 1,000')
    // Exactly the limit is still counted.
    expect(findResultText({ count: 1000, index: 999 })).toBe('1000 of 1000')
  })

  it('reads Invalid regex for an invalid one, whatever the count', () => {
    expect(findResultText({ count: 0, index: -1, invalid: true })).toBe('Invalid regex')
  })
})

describe('isValidRegex (#35 D7)', () => {
  it('takes any JavaScript regular expression and refuses the rest', () => {
    expect(isValidRegex(String.raw`file\d+\.ts`)).toBe(true)
    expect(isValidRegex('alpha')).toBe(true)
    expect(isValidRegex('file(')).toBe(false)
    expect(isValidRegex('[a-')).toBe(false)
    expect(isValidRegex('a**')).toBe(false)
  })
})
