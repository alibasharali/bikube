/**
 * The side panel's Agent tab (#75): what it shows for what is in front (D2, D3), and the session
 * id check main applies to its requests (D4). No Node imports: the renderer runs it.
 */
import type { AgentSummary } from './agent-summary'
import { findShellCard } from './workspace-shells'
import type { Card, Workspace } from './workspace-store'

/** The tab body's messages (D2, D3), worded as the spec words them. */
export const AGENT_TAB_MESSAGES = {
  board: 'Open a Claude Code card to see its agent.',
  shell: 'Run claude in this shell to see its agent here.',
  notClaude: 'The Agent tab follows Claude Code cards.',
  ssh: "The Agent tab isn't available over SSH.",
  noConversation: 'No conversation yet.'
} as const

/**
 * A message in place of a conversation, or the conversation main is asked about: a card's by its
 * folder and session id (D3), a shell's (`shell: true`) by its session id alone, `folder` being
 * the folder its Files tab shows (D3a).
 */
export type AgentTabSubject =
  | { kind: 'message'; text: string }
  | { kind: 'conversation'; folder: string; sessionId: string; shell?: true }

/** What a workspace shell keeps at runtime for the tab (D3a): whether it runs, and its session. */
export interface ShellAgent {
  running: boolean
  sessionId: string | undefined
}

const message = (text: string): AgentTabSubject => ({ kind: 'message', text })

/**
 * What the tab shows with `card` (a card or a workspace shell as a card) in front, or the board
 * when undefined: a local Claude Code card's session in its own directory (its worktree's for a
 * worktree card), a running local shell's kept session (`shell`, D3a), else D2's message.
 */
export function agentTabSubject(
  workspace: Workspace | undefined,
  card: Card | undefined,
  shell?: ShellAgent
): AgentTabSubject {
  if (!card) return message(AGENT_TAB_MESSAGES.board)
  if (card.host !== undefined) return message(AGENT_TAB_MESSAGES.ssh)
  const onBoard = workspace?.cards.some((c) => c.id === card.id) ?? false
  if (!onBoard && workspace && findShellCard(workspace, card.id)) {
    if (!shell?.running || !isSessionId(shell.sessionId)) return message(AGENT_TAB_MESSAGES.shell)
    return { kind: 'conversation', folder: card.directory, sessionId: shell.sessionId, shell: true }
  }
  if (card.startup.kind !== 'claude') return message(AGENT_TAB_MESSAGES.notClaude)
  if (!isSessionId(card.agentSessionId)) return message(AGENT_TAB_MESSAGES.noConversation)
  return { kind: 'conversation', folder: card.directory, sessionId: card.agentSessionId }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A Claude Code session id (D4): a UUID, so it names one file and nothing else. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * Main's answer to the tab's request (D3, D4, D5, D12): `none` while the session's transcript
 * doesn't exist; `conversation` with its agent summary and the version it was read at; `unchanged`
 * when the asker already holds that version; `error` for a refused request (nothing read) or a
 * transcript that can't be read.
 */
export type AgentSummaryRead =
  | { state: 'none' }
  | { state: 'conversation'; version: number; summary: AgentSummary }
  | { state: 'unchanged' }
  | { state: 'error'; reason: string }
