import { keyMoveTarget, type CardMoveDirection } from '../../core/card-moves'
import type { Workspace } from '../../core/workspace-store'
import { cardTerminals } from './card-terminals'
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
  cardTerminals().start(card, () => {
    workspaceStore.markClaudeStarted(workspaceId, cardId)
  })
}

/** Deletes a card and stops its process, freeing its terminal (#4 D13). */
export function removeCard(workspaceId: string, cardId: string): void {
  cardTerminals().dispose(cardId)
  workspaceStore.deleteCard(workspaceId, cardId)
}

/** Deletes a workspace and stops every one of its cards' processes (#4 D15). */
export function removeWorkspace(workspace: Workspace): void {
  workspace.cards.forEach((card) => cardTerminals().dispose(card.id))
  workspaceStore.deleteWorkspace(workspace.id)
}

/** The card whose open button takes focus at its next render, after a keyboard move. */
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

/** True once for the card that was just moved by keyboard, so it can refocus itself. */
export function takeFocusAfterMove(cardId: string): boolean {
  if (focusAfterMove !== cardId) return false
  focusAfterMove = null
  return true
}
