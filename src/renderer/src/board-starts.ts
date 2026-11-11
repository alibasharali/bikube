import { startOutcome, type StartOutcome } from '../../core/board-start'
import { startCard } from './card-actions'
import { cardTerminals } from './card-terminals'
import { conversationCheck } from './conversation-checks'
import { pendingWorktreeRun } from './pending-worktrees'

/**
 * The Orchestrator's `board start`, `open` and `terminal` (#81 D17, D22): a card or shell started
 * in the background as opening it would, its outcome waited for, and shown through the app's own
 * open path.
 */

/** How often a start's progress is read, in ms. */
const POLL_MS = 50
/**
 * The longest a start is waited for before it is answered as started (a worktree still being
 * made): within main's relay timeout, so the answer reaches the CLI.
 */
const START_WAIT_MS = 3000

/**
 * Starts the card or shell exactly as opening it would (`startCard`: a pending worktree made
 * first, a resuming Claude Code card's conversation checked), changing no view, and resolves once
 * its shell has spawned or its start failed, with the reason.
 */
export function startForBoard(workspaceId: string, cardId: string): Promise<StartOutcome> {
  const terminals = cardTerminals()
  // A run state from before this start (a failed one's) isn't this start's.
  const before = terminals.runState(cardId)
  startCard(workspaceId, cardId)
  return new Promise((resolve) => {
    const deadline = Date.now() + START_WAIT_MS
    const read = (): void => {
      const now = terminals.runState(cardId)
      const outcome = startOutcome({
        pendingWorktree: pendingWorktreeRun(cardId),
        conversation: conversationCheck(cardId),
        ...(now !== before && now !== undefined && { runState: now }),
        spawned: terminals.sessionId(cardId) !== undefined
      })
      if (outcome) resolve(outcome)
      else if (Date.now() >= deadline) resolve({ ok: true })
      else setTimeout(read, POLL_MS)
    }
    read()
  })
}

let openHandler: ((workspaceId: string, cardId: string) => void) | null = null

/** The app shows a card for `board open` and `board terminal --show`. Returns an unsubscribe. */
export function onBoardOpen(handler: (workspaceId: string, cardId: string) => void): () => void {
  openHandler = handler
  return () => {
    if (openHandler === handler) openHandler = null
  }
}

/** Shows the running card or shell: its workspace active, it at full size (D17). */
export function openForBoard(workspaceId: string, cardId: string): void {
  openHandler?.(workspaceId, cardId)
}
