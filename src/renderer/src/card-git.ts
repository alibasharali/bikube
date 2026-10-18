import { useSyncExternalStore } from 'react'
import type { SyncResult } from '../../core/git'

/**
 * Each worktree card's action line (#38 D6): Open pull request (and Merge) run per card, kept
 * outside any card component, since the board remounts cards on moves and workspace switches.
 * While one runs the line shows its busy label (`Pushing…`) and both items are disabled; then a
 * success's note shows for 10 s, a failure's message until dismissed or the next action. Kept for
 * the run of the app; nothing is saved.
 */
export interface CardGitAction {
  /** What is running (`Pushing…`), null when idle. */
  busy: string | null
  /** git's message when the last action failed, until dismissed or the next action. */
  error: string | null
  /** What the last action did (`Pushed · opened in the browser`), for `NOTE_MS`. */
  note: string | null
}

/** How long a success's note stays on the card (D6). */
export const NOTE_MS = 10_000

const IDLE: CardGitAction = { busy: null, error: null, note: null }

const actions = new Map<string, CardGitAction>()
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function set(cardId: string, action: CardGitAction): void {
  const timer = noteTimers.get(cardId)
  if (timer) clearTimeout(timer)
  noteTimers.delete(cardId)
  if (action.busy === null && action.error === null && action.note === null) actions.delete(cardId)
  else actions.set(cardId, action)
  if (action.note !== null) {
    noteTimers.set(
      cardId,
      setTimeout(() => {
        noteTimers.delete(cardId)
        if (actions.get(cardId) === action) set(cardId, IDLE)
      }, NOTE_MS)
    )
  }
  for (const listener of [...listeners]) listener()
}

/** The card's running action and the last one's note or error. */
export function cardGitAction(cardId: string): CardGitAction {
  return actions.get(cardId) ?? IDLE
}

export function subscribeCardGitActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Removes the card's error or note (the line's Dismiss button); a running action stays. */
export function dismissCardGitAction(cardId: string): void {
  const action = cardGitAction(cardId)
  if (action.busy === null) set(cardId, IDLE)
}

/**
 * Runs `command` as the card's one action (D6): null, running nothing, while another runs for
 * it. Busy with `label` meanwhile; afterwards its note or error (git's message, or a call that
 * failed) is kept. Never rejects.
 */
export async function runCardGitAction(
  cardId: string,
  label: string,
  command: () => Promise<SyncResult>
): Promise<SyncResult | null> {
  if (cardGitAction(cardId).busy !== null) return null
  set(cardId, { busy: label, error: null, note: null })
  let result: SyncResult
  try {
    result = await command()
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  set(
    cardId,
    result.ok
      ? { busy: null, error: null, note: result.note }
      : { busy: null, error: result.reason, note: null }
  )
  return result
}

/** The card's action line, for its component. */
export function useCardGitAction(cardId: string): CardGitAction {
  return useSyncExternalStore(subscribeCardGitActions, () => cardGitAction(cardId))
}
