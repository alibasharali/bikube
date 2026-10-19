import { useSyncExternalStore } from 'react'
import type { ClaudeUsage } from '../../core/claude-pricing'
import { workspaceUsage, type WorkspaceUsage } from '../../core/usage-format'

/**
 * Each card's Claude Code usage (#50 D7), as its last `board usage` report gave it: runtime only,
 * never saved, synced or kept with its output. Replaced by each report, kept across a stop or a
 * start, gone when a zero report arrives, when the card is deleted (`disposeCard`) or at quit.
 */
const usages = new Map<string, ClaudeUsage>()
const listeners = new Set<() => void>()
/** Bumped on every change, the stable snapshot for hooks reading many cards. */
let version = 0

function changed(): void {
  version++
  for (const listener of [...listeners]) listener()
}

/** The card's usage, undefined when it has none. */
export function cardUsage(cardId: string): ClaudeUsage | undefined {
  return usages.get(cardId)
}

/** A report for the card (D5): replaces its usage, or forgets it when nothing was counted. */
export function setCardUsage(cardId: string, usage: ClaudeUsage): void {
  if (usage.tokens > 0) usages.set(cardId, usage)
  else if (!usages.delete(cardId)) return
  changed()
}

/** Forgets the card's usage (deleted). */
export function clearCardUsage(cardId: string): void {
  if (usages.delete(cardId)) changed()
}

/** Calls `listener` on every change to any card's usage. Returns an unsubscribe function. */
export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The card's usage, live. */
export function useCardUsage(cardId: string): ClaudeUsage | undefined {
  return useSyncExternalStore(subscribeUsage, () => cardUsage(cardId))
}

/** The total of the cards' usage for the title bar (D9), live; null when none has usage. */
export function useWorkspaceUsage(cardIds: readonly string[]): WorkspaceUsage | null {
  useSyncExternalStore(subscribeUsage, () => version)
  return workspaceUsage(cardIds.map(cardUsage))
}
