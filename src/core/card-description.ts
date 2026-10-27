/**
 * A card's description (#69 D1, D4): plain markdown text, shown and edited as text, never
 * rendered. Plain TS with no Node imports, so the renderer, main and `board` can share it.
 */
import type { Result } from './workspace-store'

/** The most characters (code points, multi-byte included) a description may have (D1). */
export const MAX_DESCRIPTION_LENGTH = 100_000

/** The dialogs show the length against the cap only past this many characters (D3). */
export const DESCRIPTION_COUNTER_FROM = 90_000

/** Lines and characters per line the board card's tooltip shows (D4). */
const TOOLTIP_LINES = 5
const TOOLTIP_LINE_LENGTH = 120

/** Its length in characters: code points, so an emoji counts once. */
export const descriptionLength = (text: string): number => {
  let n = 0
  // Every UTF-16 unit but a pair's high surrogate starts a code point.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit < 0xd800 || unit > 0xdbff) n++
  }
  return n
}

/** Trailing whitespace trimmed; an empty one is none (D1). */
export function normalizeDescription(text: string): string | undefined {
  const trimmed = text.trimEnd()
  return trimmed === '' ? undefined : trimmed
}

/** The description to keep (undefined for none), or the error when it is over the cap (D1). */
export function checkDescription(text: string): Result<string | undefined> {
  const value = normalizeDescription(text)
  if (value !== undefined && descriptionLength(value) > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'description',
        message: `Description is longer than ${MAX_DESCRIPTION_LENGTH.toLocaleString('en-US')} characters`
      }
    }
  }
  return { ok: true, value }
}

/** Whether a saved or synced value is a description as the store keeps one. */
export const isDescription = (value: unknown): value is string =>
  typeof value === 'string' && checkDescription(value).ok && normalizeDescription(value) === value

/**
 * The board card icon's tooltip (D4): the first 5 lines, each cut at 120 characters with `…`,
 * and a last `…` line when there are more.
 */
export function descriptionTooltip(description: string): string {
  const lines = description.split('\n')
  const shown = lines.slice(0, TOOLTIP_LINES).map((line) => {
    const chars = [...line]
    return chars.length > TOOLTIP_LINE_LENGTH
      ? `${chars.slice(0, TOOLTIP_LINE_LENGTH).join('')}…`
      : line
  })
  if (lines.length > TOOLTIP_LINES) shown.push('…')
  return shown.join('\n')
}
