import { useSyncExternalStore } from 'react'
import { conversationCheckTarget } from '../../core/transcript-backup-target'
import type { Card } from '../../core/workspace-store'
import { workspaceStore } from './store'

/**
 * A local Claude Code card's conversation check before it resumes (#80 D11): being checked, or
 * gone (D12: neither the transcript nor a backup is on this machine), in this run.
 */
export type ConversationCheck = { kind: 'checking' } | { kind: 'gone' }

const checks = new Map<string, ConversationCheck>()
const listeners = new Set<() => void>()

function set(cardId: string, check: ConversationCheck | null): void {
  if (check) checks.set(cardId, check)
  else checks.delete(cardId)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The card's conversation being checked or gone in this run; undefined otherwise. */
export function conversationCheck(cardId: string): ConversationCheck | undefined {
  return checks.get(cardId)
}

/** `conversationCheck`, for a component. */
export function useConversationCheck(cardId: string): ConversationCheck | undefined {
  return useSyncExternalStore(subscribe, () => conversationCheck(cardId))
}

const findCard = (workspaceId: string, cardId: string): Card | undefined =>
  workspaceStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
    ?.cards.find((c) => c.id === cardId)

/**
 * Starts the card, first asking main to prepare its Claude Code conversation when it is a local
 * Claude Code card that started Claude Code (D11): present or put back from its backup, it starts
 * as it now is; missing, it isn't started and its card view asks (D12); a failed or refused check
 * starts it as today. Every other card starts at once (AC12). A deleted card starts nothing.
 */
export function startCheckingConversation(
  workspaceId: string,
  card: Card,
  start: (card: Card) => void
): void {
  const target = conversationCheckTarget(card)
  if (!target) {
    forgetConversationCheck(card.id)
    start(card)
    return
  }
  if (checks.get(card.id)?.kind === 'checking') return
  set(card.id, { kind: 'checking' })
  const startNow = (): void => {
    const current = findCard(workspaceId, card.id)
    // Started first, so the card view never sees it neither running nor checked.
    if (current) start(current)
    set(card.id, null)
  }
  window.bikube.transcripts.prepare(card.id, target.folder, target.sessionId).then((found) => {
    if (found === 'missing' && findCard(workspaceId, card.id)) set(card.id, { kind: 'gone' })
    else startNow()
  }, startNow)
}

/** Forgets the card's check, once it starts another way (Start a new conversation). */
export function forgetConversationCheck(cardId: string): void {
  if (checks.has(cardId)) set(cardId, null)
}
