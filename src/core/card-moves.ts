/** Keyboard moves of a card on the board (#6 D7). Plain TS, no DOM imports. */
import type { KeyLike } from './clipboard'
import { cardsInColumn, type Workspace } from './workspace-store'

export type CardMoveDirection = 'up' | 'down' | 'left' | 'right'

/** Where a move puts the card, as `moveCard` takes it (#6 D3). */
export interface CardMoveTarget {
  columnId: string
  index: number
}

const ARROWS: Record<string, CardMoveDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

/** The move an Alt+arrow asks for; plain arrows and other modifiers are not moves. */
export function cardMoveKey(event: KeyLike): CardMoveDirection | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  return ARROWS[event.key] ?? null
}

/**
 * Where the card goes: up or down one place in its column, or the bottom of the previous or
 * next column. Null at an end (top, bottom, first or last column) or for an unknown card.
 */
export function keyMoveTarget(
  workspace: Workspace,
  cardId: string,
  direction: CardMoveDirection
): CardMoveTarget | null {
  const card = workspace.cards.find((c) => c.id === cardId)
  if (!card) return null
  if (direction === 'up' || direction === 'down') {
    const cards = cardsInColumn(workspace, card.columnId)
    const at = cards.findIndex((c) => c.id === cardId)
    const index = direction === 'up' ? at - 1 : at + 1
    if (index < 0 || index >= cards.length) return null
    return { columnId: card.columnId, index }
  }
  const columnAt = workspace.columns.findIndex((c) => c.id === card.columnId)
  const next = workspace.columns[columnAt + (direction === 'left' ? -1 : 1)]
  if (columnAt < 0 || !next) return null
  return { columnId: next.id, index: cardsInColumn(workspace, next.id).length }
}
