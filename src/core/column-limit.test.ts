import { describe, expect, it } from 'vitest'
import { COLUMN_CARD_LIMIT, isColumnCardLimit, shownCards, showAllLabel } from './column-limit'
import { parseColumnCardLimit } from './settings-form'

const cards = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('shownCards', () => {
  it('shows the first `limit` cards of a folded column and every card of an unfolded one', () => {
    expect(COLUMN_CARD_LIMIT).toBe(10)
    expect(shownCards(cards(14), false, 10)).toEqual(cards(10))
    expect(shownCards(cards(14), false, 3)).toEqual(cards(3))
    expect(shownCards(cards(14), true, 3)).toEqual(cards(14))
    expect(shownCards(cards(3), false, 10)).toEqual(cards(3))
  })
})

describe('showAllLabel', () => {
  it('offers Show all past the limit and Show fewer once unfolded, nothing within it', () => {
    expect(showAllLabel(10, false, 10)).toBeNull()
    expect(showAllLabel(10, true, 10)).toBeNull()
    expect(showAllLabel(11, false, 10)).toBe('Show all 11 cards')
    expect(showAllLabel(11, true, 10)).toBe('Show fewer')
    expect(showAllLabel(4, false, 3)).toBe('Show all 4 cards')
  })
})

describe('the Cards per column setting', () => {
  it('takes a whole number from 1 to 100', () => {
    expect([1, 10, 100].every(isColumnCardLimit)).toBe(true)
    expect([0, 101, 2.5, '10', null].some(isColumnCardLimit)).toBe(false)
    expect(parseColumnCardLimit(' 25 ')).toBe(25)
    for (const text of ['', '0', '101', '1.5', '-3', 'ten']) {
      expect(parseColumnCardLimit(text)).toBeNull()
    }
  })
})
