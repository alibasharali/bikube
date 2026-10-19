/** A card window's frame name (#53 D3), shared by the page that opens it and main. Plain TS. */

/** What every card window's frame name starts with; the card or shell id follows. */
export const CARD_WINDOW_PREFIX = 'drovr-card:'

/** The frame name the page opens card `cardId`'s window with. */
export function cardWindowName(cardId: string): string {
  return `${CARD_WINDOW_PREFIX}${cardId}`
}
