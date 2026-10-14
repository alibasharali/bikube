/** The Settings dialog's field rules (#10 D5), free of DOM imports. */
import { DEFAULT_FONT_FAMILY, MAX_FONT_SIZE, MIN_FONT_SIZE, isFontSize } from './settings'

export const FONT_SIZE_ERROR = `Font size must be a whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}`

/** The size typed in the Font size field, or null when it isn't a whole number from 8 to 32. */
export function parseFontSize(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const size = Number(trimmed)
  return isFontSize(size) ? size : null
}

/** What the Font family field shows: empty for the default family, so its placeholder shows. */
export function fontFamilyField(family: string): string {
  return family === DEFAULT_FONT_FAMILY ? '' : family
}
