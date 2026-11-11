import type { Card } from './workspace-store'

/**
 * What a card's transcript backup names (#80 D8): a local Claude Code card's folder (where its
 * `claude` runs, so a worktree card's is in its worktree) and current session; null for an SSH
 * card, a plain card, a preset or a custom command, which are never backed up. Node-free.
 */
export function transcriptBackupTarget(card: Card): { folder: string; sessionId: string } | null {
  if (card.host !== undefined || card.startup.kind !== 'claude') return null
  return { folder: card.directory, sessionId: card.agentSessionId }
}

/**
 * What a card's start checks before it resumes (#80 D11): `transcriptBackupTarget` for a card that
 * has started Claude Code (`claudeStarted`), so it types its resume line; null for every other,
 * which starts with no check (AC12).
 */
export function conversationCheckTarget(card: Card): { folder: string; sessionId: string } | null {
  return card.claudeStarted ? transcriptBackupTarget(card) : null
}
