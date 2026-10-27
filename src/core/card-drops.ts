/** Where a dragged card lands on a column (#6 D5, D6). Plain TS, no DOM imports. */

/** The pointer over one of the column's cards, in its top or bottom half. */
export interface CardHover {
  cardId: string
  half: 'top' | 'bottom'
}

/**
 * The drop position `moveCard` takes (#6 D3): counted among the column's cards without the
 * dragged one. Over a card, above it in its top half and below it in its bottom half; over
 * the dragged card itself, its own place. `'bottom'` (the header, the empty area, the space
 * below the last card, `+ New card`) or an unknown card means the bottom.
 */
export function dropIndex(
  columnCardIds: readonly string[],
  draggedId: string,
  over: CardHover | 'bottom'
): number {
  const others = columnCardIds.filter((id) => id !== draggedId)
  if (over === 'bottom') return others.length
  if (over.cardId === draggedId) return columnCardIds.indexOf(draggedId)
  const at = others.indexOf(over.cardId)
  if (at < 0) return others.length
  return over.half === 'top' ? at : at + 1
}

/**
 * The drop position on a column sorted recently opened first (#69 D12), which shows no stored
 * order to drop into: a card from another column goes to the bottom of it, and a card already in
 * the column stays where it is (null: no move).
 */
export function sortedDropIndex(
  columnCardIds: readonly string[],
  draggedId: string
): number | null {
  return columnCardIds.includes(draggedId) ? null : columnCardIds.length
}

/** Which half of a card the pointer is in, from its vertical position and the card's box. */
export function hoverHalf(pointerY: number, top: number, height: number): CardHover['half'] {
  return pointerY < top + height / 2 ? 'top' : 'bottom'
}

/** A card's vertical box on screen, for `nearestCardHover`. */
export interface CardBox {
  cardId: string
  top: number
  height: number
}

/**
 * The hover for a pointer over the column's card list (#6 D6), given its cards' boxes in
 * order: over a card or in the gap between two (or just above the first), the nearest card
 * and the half of it the pointer is on. At or below the last card's bottom edge, or with no
 * cards, `'bottom'`.
 */
export function nearestCardHover(
  boxes: readonly CardBox[],
  pointerY: number
): CardHover | 'bottom' {
  const last = boxes[boxes.length - 1]
  if (!last || pointerY >= last.top + last.height) return 'bottom'
  let nearest = last
  let best = Number.POSITIVE_INFINITY
  for (const box of boxes) {
    const distance = Math.max(box.top - pointerY, pointerY - (box.top + box.height), 0)
    if (distance < best) {
      best = distance
      nearest = box
    }
  }
  return { cardId: nearest.cardId, half: hoverHalf(pointerY, nearest.top, nearest.height) }
}
