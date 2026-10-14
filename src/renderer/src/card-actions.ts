import { keyMoveTarget, type CardMoveDirection } from '../../core/card-moves'
import type { Workspace } from '../../core/workspace-store'
import { cardPanes, cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * Starts the card if its shell isn't running, with its current startup command (#5 D7, D8);
 * a running card is left as it is. Opening a card, and creating one, goes through here.
 */
export function startCard(workspaceId: string, cardId: string): void {
  const card = workspaceStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
    ?.cards.find((c) => c.id === cardId)
  if (!card) return
  cardTerminals().start(card, (kind) => {
    if (kind === 'claude') workspaceStore.markClaudeStarted(workspaceId, cardId)
    else workspaceStore.markAgentStarted(workspaceId, cardId, kind)
  })
}

/**
 * Closes a running card (#7 D1, D2): stops its process and keeps the card where it is; it turns
 * Stopped when its shell has exited. Anything else is left as it is.
 */
export function closeCard(cardId: string): void {
  cardTerminals().close(cardId)
}

/** Stops every pane's process of a card being deleted and frees its screens (#11 D6). */
export function disposeCard(cardId: string): void {
  cardPanes().dispose(cardId)
  cardTerminals().dispose(cardId)
}

/** Deletes a card and stops its processes, freeing its terminals (#4 D13, #11 D6). */
export function removeCard(workspaceId: string, cardId: string): void {
  disposeCard(cardId)
  workspaceStore.deleteCard(workspaceId, cardId)
}

/** Deletes a workspace and stops every one of its cards' processes (#4 D15, #11 D6). */
export function removeWorkspace(workspace: Workspace): void {
  workspace.cards.forEach((card) => disposeCard(card.id))
  workspaceStore.deleteWorkspace(workspace.id)
}

/** The card whose open button takes focus at its next render, after a keyboard or menu move. */
let focusAfterMove: string | null = null

/**
 * Moves a card one step with the keyboard (#6 D7); at an end nothing happens. Returns whether
 * it moved; the moved card then takes focus back (see `takeFocusAfterMove`).
 */
export function moveCardByKey(
  workspaceId: string,
  cardId: string,
  direction: CardMoveDirection
): boolean {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  const target = workspace && keyMoveTarget(workspace, cardId, direction)
  if (!target) return false
  focusAfterMove = cardId
  const moved = workspaceStore.moveCard(workspaceId, cardId, target.columnId, target.index).ok
  if (!moved) focusAfterMove = null
  return moved
}

/**
 * Moves a card to the bottom of another column from its menu (#6 D8). The card remounts
 * there and takes focus back (see `takeFocusAfterMove`).
 */
export function moveCardToColumn(workspaceId: string, cardId: string, columnId: string): boolean {
  focusAfterMove = cardId
  const moved = workspaceStore.moveCard(workspaceId, cardId, columnId, Number.POSITIVE_INFINITY).ok
  if (!moved) focusAfterMove = null
  return moved
}

/** True once for the card that was just moved by keyboard or menu, so it can refocus itself. */
export function takeFocusAfterMove(cardId: string): boolean {
  if (focusAfterMove !== cardId) return false
  focusAfterMove = null
  return true
}
