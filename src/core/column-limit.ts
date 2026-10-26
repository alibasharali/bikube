/**
 * How many cards a board column or a grid section shows before its Show all button: the Card
 * display limit setting.
 * Plain TS, no DOM.
 */

/** The setting's default: a folded column shows its first 10 cards. */
export const COLUMN_CARD_LIMIT = 10
export const MIN_COLUMN_CARD_LIMIT = 1
export const MAX_COLUMN_CARD_LIMIT = 100

export const isColumnCardLimit = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_COLUMN_CARD_LIMIT &&
  value <= MAX_COLUMN_CARD_LIMIT

/**
 * The cards a column shows: all of them when unfolded or within `limit`, else its first `limit`, a
 * prefix, so a position among them is the same among all its cards.
 */
export function shownCards<T>(cards: readonly T[], expanded: boolean, limit: number): T[] {
  return expanded ? [...cards] : cards.slice(0, limit)
}

/** The Show all button's label for a column of `count` cards, or null when it needs none. */
export function showAllLabel(count: number, expanded: boolean, limit: number): string | null {
  if (count <= limit) return null
  return expanded ? 'Show fewer' : `Show all ${count} cards`
}
