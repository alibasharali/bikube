/**
 * How many cards a board column shows before its Show all button. Plain TS, no DOM.
 */

/** A folded column shows this many cards, its first. */
export const COLUMN_CARD_LIMIT = 10

/**
 * The cards a column shows: all of them when unfolded or within the limit, else its first
 * `COLUMN_CARD_LIMIT`, a prefix, so a position among them is the same among all its cards.
 */
export function shownCards<T>(cards: readonly T[], expanded: boolean): T[] {
  return expanded ? [...cards] : cards.slice(0, COLUMN_CARD_LIMIT)
}

/** The Show all button's label for a column of `count` cards, or null when it needs none. */
export function showAllLabel(count: number, expanded: boolean): string | null {
  if (count <= COLUMN_CARD_LIMIT) return null
  return expanded ? 'Show fewer' : `Show all ${count} cards`
}
