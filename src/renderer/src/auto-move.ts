import { autoMoveTarget, type AutoMoveEvent } from '../../core/auto-move'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * Automatic moves (#42 D3–D5, D8): as a card's activity changes or its shell stops, its
 * workspace's rules move it through the store, so the move is saved and synced like `board move`.
 * Only this instance applies them, since activity and stops are runtime only. A workspace's
 * shells aren't cards of any workspace, so nothing moves them.
 */

let started = false
/** Set once the app starts quitting: the shells main stops then move no card (D4). */
let quitting = false

function apply(cardId: string, event: AutoMoveEvent): void {
  for (const workspace of workspaceStore.getState().workspaces) {
    const card = workspace.cards.find((c) => c.id === cardId)
    if (!card) continue
    const target = autoMoveTarget(workspace, card, event)
    if (target) workspaceStore.moveCard(workspace.id, card.id, target.columnId, target.index)
    return
  }
}

/** Watches every card's activity and stops; called once, before the first render. */
export function startAutoMoves(): void {
  if (started) return
  started = true
  window.bikube.app.onQuitting(() => {
    quitting = true
  })
  const terminals = cardTerminals()
  // Called only when a card's activity changes (D3).
  terminals.onActivity((cardId, activity) => apply(cardId, { kind: 'activity', activity }))
  terminals.onEnded((cardId) => {
    const state = terminals.runState(cardId)
    if (state && !quitting) apply(cardId, { kind: 'ended', state })
  })
}
