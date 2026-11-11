/**
 * `board start`'s and `board open`'s outcome (#81 D17): a start goes through a pending worktree
 * (#69 D10) and a conversation check (#80 D11) before its shell spawns, and either can refuse it.
 * Plain TS: the renderer reads where each is and asks this until it answers.
 */
import type { CardRunState } from './card-status'

/** How a start ended: its shell spawned, or the reason it couldn't. */
export type StartOutcome = { ok: true } | { ok: false; reason: string }

/** Where a start is: each part as the renderer reads it now, absent while it has none. */
export interface StartProgress {
  /** The card's pending worktree being made or failed in this run (#69 D10). */
  pendingWorktree?: { kind: 'making' } | { kind: 'failed'; reason: string }
  /** Its conversation being checked or gone (#80 D11, D12). */
  conversation?: { kind: 'checking' } | { kind: 'gone' }
  /** Its run state since the start began; absent while it is still the one before. */
  runState?: CardRunState
  /** Whether its shell has a session in main. */
  spawned: boolean
}

/** The reason a start fails when its Claude Code conversation is gone (#80 D12). */
export const CONVERSATION_GONE_REASON = "its Claude Code conversation isn't on this machine"

/** The start's outcome, or null while it is still going. */
export function startOutcome(progress: StartProgress): StartOutcome | null {
  const { pendingWorktree, conversation, runState } = progress
  if (pendingWorktree?.kind === 'failed') return { ok: false, reason: pendingWorktree.reason }
  if (conversation?.kind === 'gone') return { ok: false, reason: CONVERSATION_GONE_REASON }
  if (runState?.kind === 'failed') return { ok: false, reason: runState.reason }
  if (pendingWorktree || conversation || !runState) return null
  // A shell that exited at once still started.
  if (runState.kind === 'stopped') return { ok: true }
  return progress.spawned ? { ok: true } : null
}
