/**
 * Find in a terminal (#35), free of DOM imports: the result text the find bar shows and the
 * regular expression check made before searching.
 */

/** The most matches the bar counts (#35 D7): the search addon's highlight limit. */
export const FIND_HIGHLIGHT_LIMIT = 1000

/**
 * A search's outcome as the bar reads it: `count` matches in the buffer, `index` the active one's
 * position from the top (-1 when unknown), `invalid` a Regex query that isn't a regular expression.
 */
export interface FindResults {
  count: number
  index: number
  invalid?: boolean
}

/**
 * The bar's result text (#35 D7): `<n> of <m>` with `n` counted from the bottom, so the newest
 * match the search starts on reads `1 of <m>` and Enter counts up as it goes back; `No results`,
 * `Invalid regex`, or `More than 1,000` past the limit, where `n` isn't known; the count alone
 * when no match is active.
 */
export function findResultText({ count, index, invalid }: FindResults): string {
  if (invalid) return 'Invalid regex'
  if (count === 0) return 'No results'
  if (count > FIND_HIGHLIGHT_LIMIT) return 'More than 1,000'
  // No active match known (none selected): the count alone.
  if (index < 0) return count === 1 ? '1 result' : `${count} results`
  return `${count - index} of ${count}`
}

/** Whether `query` is a JavaScript regular expression, as the addon builds it (#35 D7). */
export function isValidRegex(query: string): boolean {
  try {
    new RegExp(query, 'g')
    return true
  } catch {
    return false
  }
}
