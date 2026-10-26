import { describe, expect, it } from 'vitest'
import { COLUMN_CARD_LIMIT, shownCards, showAllLabel } from './column-limit'

const cards = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('shownCards', () => {
  it('shows the first 10 of a folded column and every card of an unfolded one', () => {
    expect(COLUMN_CARD_LIMIT).toBe(10)
    expect(shownCards(cards(14), false)).toEqual(cards(10))
    expect(shownCards(cards(14), true)).toEqual(cards(14))
    expect(shownCards(cards(3), false)).toEqual(cards(3))
  })
})

describe('showAllLabel', () => {
  it('offers Show all past the limit and Show fewer once unfolded, nothing within it', () => {
    expect(showAllLabel(10, false)).toBeNull()
    expect(showAllLabel(10, true)).toBeNull()
    expect(showAllLabel(11, false)).toBe('Show all 11 cards')
    expect(showAllLabel(11, true)).toBe('Show fewer')
  })
})
