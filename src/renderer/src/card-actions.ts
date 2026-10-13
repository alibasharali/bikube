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
