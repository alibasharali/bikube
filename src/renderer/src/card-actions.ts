import type { Workspace } from '../../core/workspace-store'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

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
