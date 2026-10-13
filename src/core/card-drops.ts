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

/** Which half of a card the pointer is in, from its vertical position and the card's box. */
export function hoverHalf(pointerY: number, top: number, height: number): CardHover['half'] {
  return pointerY < top + height / 2 ? 'top' : 'bottom'
}
