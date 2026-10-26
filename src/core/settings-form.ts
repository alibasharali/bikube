/** The Settings dialog's field rules (#10 D5), free of DOM imports. */
import { MAX_COLUMN_CARD_LIMIT, MIN_COLUMN_CARD_LIMIT, isColumnCardLimit } from './column-limit'
import { DEFAULT_FONT_FAMILY, MAX_FONT_SIZE, MIN_FONT_SIZE, isFontSize } from './settings'

export const FONT_SIZE_ERROR = `Font size must be a whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}`

/** The size typed in the Font size field, or null when it isn't a whole number from 8 to 32. */
export function parseFontSize(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const size = Number(trimmed)
  return isFontSize(size) ? size : null
}

export const COLUMN_CARD_LIMIT_ERROR = `Card display limit must be a whole number from ${MIN_COLUMN_CARD_LIMIT} to ${MAX_COLUMN_CARD_LIMIT}`

/** The number typed in the Card display limit field, or null when it isn't one from 1 to 100. */
export function parseColumnCardLimit(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const limit = Number(trimmed)
  return isColumnCardLimit(limit) ? limit : null
}

/** What the Font family field shows: empty for the default family, so its placeholder shows. */
export function fontFamilyField(family: string): string {
  return family === DEFAULT_FONT_FAMILY ? '' : family
}
