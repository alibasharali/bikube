import { useSyncExternalStore } from 'react'
import type { Card } from '../../core/workspace-store'
import { workspaceStore } from './store'

/** Where a card's pending worktree (#69 D10) is at its first open: being made, or failed. */
export type PendingWorktreeRun = { kind: 'making' } | { kind: 'failed'; reason: string }

const runs = new Map<string, PendingWorktreeRun>()
const listeners = new Set<() => void>()

function set(cardId: string, run: PendingWorktreeRun | null): void {
  if (run) runs.set(cardId, run)
  else runs.delete(cardId)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The card's pending worktree being made or failed in this run; undefined otherwise. */
export function usePendingWorktree(cardId: string): PendingWorktreeRun | undefined {
  return useSyncExternalStore(subscribe, () => runs.get(cardId))
}

const findCard = (workspaceId: string, cardId: string): Card | undefined =>
  workspaceStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
    ?.cards.find((c) => c.id === cardId)

/**
 * Makes the card's pending worktree (#69 D10) as Move to own worktree… does: main creates it on
 * its branch from the workspace folder, the card moves there in the store (the Worktree setup
 * queued, a new agent session, the pending worktree cleared in the same change), then `start`
 * starts it. A failure keeps the card pending and shows git's reason in the card view. A card
 * whose worktree another machine made meanwhile (synced), or whose pending one was dropped, gets
 * this one removed again and starts as it now is; a deleted card starts nothing.
 */
export function makePendingWorktree(
  workspaceId: string,
  card: Card,
  start: (card: Card) => void
): void {
  const pending = card.pendingWorktree
  if (!pending || runs.get(card.id)?.kind === 'making') return
  set(card.id, { kind: 'making' })
  const repo = card.directory
  const discard = (path: string): void => {
    void window.bikube.worktree.remove(repo, path, false)
  }
  void window.bikube.worktree.create(repo, pending.branch).then(
    (made) => {
      const current = findCard(workspaceId, card.id)
      if (!current) {
        if (made.ok) discard(made.path)
        set(card.id, null)
        return
      }
      if (!made.ok) {
        set(card.id, { kind: 'failed', reason: made.reason })
        return
      }
      if (!current.pendingWorktree || current.worktree) {
        discard(made.path)
        start(current)
        set(card.id, null)
        return
      }
      const moved = workspaceStore.moveCardToWorktree(workspaceId, card.id, {
        directory: made.directory,
        worktree: { path: made.path, branch: made.branch, repo }
      })
      if (!moved.ok) {
        discard(made.path)
        set(card.id, { kind: 'failed', reason: moved.error.message })
        return
      }
      // Started first, so the card view never sees it neither running nor pending.
      start(moved.value)
      set(card.id, null)
    },
    (error: unknown) => set(card.id, { kind: 'failed', reason: String(error) })
  )
}

/** Forgets the card's failed run, once it runs another way (Run in workspace folder). */
export function forgetPendingWorktree(cardId: string): void {
  if (runs.has(cardId)) set(cardId, null)
}
