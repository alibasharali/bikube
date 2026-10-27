import { useSyncExternalStore } from 'react'
import type { ClaudeUsage } from '../../core/claude-usage-types'

/**
 * Each card's Claude Code usage (#50 D7), as its last `board usage` report gave it: seeded at
 * launch from the card's saved `lastUsage` (this machine's, never synced or kept with its output).
 * Replaced by each report, kept across a stop or a start, gone when a zero report arrives or when
 * the card is deleted (`disposeCard`).
 */
const usages = new Map<string, ClaudeUsage>()
const listeners = new Set<() => void>()
function changed(): void {
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
