/**
 * The card being dragged on the board (#6 D5). The data transfer carries only the card's
 * id under its own type; this says which workspace it belongs to, so a column accepts only
 * cards of its own board.
 */
export const CARD_DRAG_TYPE = 'application/x-bikube-card'

export interface CardDrag {
  workspaceId: string
  cardId: string
}

let current: CardDrag | null = null

export function startCardDrag(drag: CardDrag): void {
  current = drag
}

export function endCardDrag(): void {
  current = null
}

/** The card being dragged if the event carries one from workspace `workspaceId`, else null. */
export function draggedCard(workspaceId: string, transfer: DataTransfer | null): CardDrag | null {
  if (!current || current.workspaceId !== workspaceId) return null
  if (!transfer?.types.includes(CARD_DRAG_TYPE)) return null
  return current
}
