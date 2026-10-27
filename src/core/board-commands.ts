/**
 * Resolving `board` commands against the board (#9 D2, D7, D8). Plain TS: the renderer runs
 * these against its store and answers with the error text, which the CLI prints verbatim.
 */

import type { BoardAgent, BoardCommand } from './board-args'
import type { CardMoveTarget } from './card-moves'
import type { StartupCommand } from './startup-command'
import { stripEscapes } from './card-status'
import {
  cardsInColumn,
  type Card,
  type Column,
  type Workspace,
  type WorkspaceState
} from './workspace-store'

export type BoardResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const NOT_IN_A_CARD = 'board: not running inside a Bikube card'
/** Longest agent status, in characters (#9 D8). */
export const MAX_AGENT_STATUS_LENGTH = 200

/** `.` names the calling card (#9 D2). */
export const CALLING_CARD = '.'

/** The workspace holding the calling card, whichever workspace is active (#9 D2, D3). */
export function findCallingWorkspace(
  state: WorkspaceState,
  callingCardId: string
): BoardResult<Workspace> {
  const workspace = state.workspaces.find((w) => w.cards.some((c) => c.id === callingCardId))
  return workspace ? { ok: true, value: workspace } : { ok: false, error: NOT_IN_A_CARD }
}

/**
 * The card `<card>` names in the calling card's workspace: `.` is the calling card, then an
 * id, then an exact case-sensitive title that only one card has (#9 D2).
 */
export function resolveCard(
  workspace: Workspace,
  callingCardId: string,
  ref: string
): BoardResult<Card> {
  const id = ref === CALLING_CARD ? callingCardId : ref
  const byId = workspace.cards.find((c) => c.id === id)
  if (byId) return { ok: true, value: byId }
  const byTitle = workspace.cards.filter((c) => c.title === ref)
  if (byTitle.length === 1) return { ok: true, value: byTitle[0] }
  if (byTitle.length > 1) {
    return {
      ok: false,
      error: `board: ${byTitle.length} cards are titled "${ref}"; use the card id`
    }
  }
  return { ok: false, error: `board: no card "${ref}" in this workspace` }
}

/**
 * The workspace `--workspace <ref>` names (#69 D6): an exact id, else a name matched
 * case-insensitively; none, or more than one name match, is refused.
 */
export function resolveWorkspace(state: WorkspaceState, ref: string): BoardResult<Workspace> {
  const byId = state.workspaces.find((w) => w.id === ref)
  if (byId) return { ok: true, value: byId }
  const wanted = ref.trim().toLowerCase()
  const byName = state.workspaces.filter((w) => w.name.toLowerCase() === wanted)
  if (byName.length === 1) return { ok: true, value: byName[0] }
  if (byName.length > 1) {
    return { ok: false, error: `board: ${byName.length} workspaces are named ${ref}; use its id` }
  }
  return { ok: false, error: `board: no workspace named ${ref}` }
}

/** A card with the workspace holding it. */
export interface PlacedCard {
  workspace: Workspace
  card: Card
}

/**
 * The card `<card>` names for a local card's `board` (#69 D7): `.` is the calling card and a
 * card's id names it in any workspace; a title resolves only in `titles`, the calling card's
 * workspace or the one `--workspace` names.
 */
export function resolveAnyCard(
  state: WorkspaceState,
  titles: Workspace,
  callingCardId: string,
  ref: string
): BoardResult<PlacedCard> {
  const id = ref === CALLING_CARD ? callingCardId : ref
  for (const workspace of state.workspaces) {
    const card = workspace.cards.find((c) => c.id === id)
    if (card) return { ok: true, value: { workspace, card } }
  }
  const byTitle = resolveCard(titles, callingCardId, ref)
  return byTitle.ok ? { ok: true, value: { workspace: titles, card: byTitle.value } } : byTitle
}

/** The commands whose `<card>` may be another workspace's card, by its id (#69 D7). */
export const ACROSS_WORKSPACES: ReadonlySet<BoardCommand['command']> = new Set([
  'rename',
  'move',
  'status',
  'description',
  'describe'
])

/** `resolveCard`'s result with the workspace it resolved in. */
export function placedIn(workspace: Workspace, card: BoardResult<Card>): BoardResult<PlacedCard> {
  return card.ok ? { ok: true, value: { workspace, card: card.value } } : card
}

/**
 * Whether an SSH card's `board` may send `command` (#69 D9): its session socket serves only its
 * own card's workspace, so never `workspaces`, `create`, `rename`, `describe` or a `--workspace`.
 */
export function servesRemoteCard(command: BoardCommand): boolean {
  if ('workspace' in command && command.workspace !== undefined) return false
  return !REMOTE_REFUSED.has(command.command)
}

const REMOTE_REFUSED: ReadonlySet<BoardCommand['command']> = new Set([
  'workspaces',
  'create',
  'rename',
  'describe'
])

/** The startup `board create --agent <agent>` gives a card (#69 D8). */
export function agentStartup(agent: BoardAgent): StartupCommand {
  return { kind: agent }
}

/**
 * The startup a card `board create` makes without `--agent` gets from the calling card (#69 D8):
 * its agent, or undefined (the target workspace's default) for a Custom command or a shell.
 */
export function inheritedStartup(calling: Card): StartupCommand | undefined {
  const { kind } = calling.startup
  return kind === 'custom' || kind === 'shell' ? undefined : { kind }
}

/** The column `<column>` names: a title matched case-insensitively after trimming (#9 D7). */
export function resolveColumn(workspace: Workspace, ref: string): BoardResult<Column> {
  const wanted = ref.trim().toLowerCase()
  const column = workspace.columns.find((c) => c.name.toLowerCase() === wanted)
  if (column) return { ok: true, value: column }
  const names = workspace.columns.map((c) => c.name).join(', ')
  return { ok: false, error: `board: no column "${ref}"; columns are: ${names}` }
}

/**
 * Where `board move` puts the card: the bottom of the column, as `moveCard` takes it; null
 * when it is already in that column, which changes nothing (#9 D7).
 */
export function boardMoveTarget(
  workspace: Workspace,
  card: Card,
  columnId: string
): CardMoveTarget | null {
  if (card.columnId === columnId) return null
  return { columnId, index: cardsInColumn(workspace, columnId).length }
}

/**
 * The agent status `board status` sets: escapes and control characters removed, whitespace
 * collapsed to single spaces and trimmed, cut to 200 characters. Empty clears it (#9 D8).
 */
export function cleanAgentStatus(text: string): string {
  const cleaned = stripEscapes(text).replace(/\s+/g, ' ').trim()
  // Cut by code points so a surrogate pair is never split.
  const chars = Array.from(cleaned)
  return chars.length > MAX_AGENT_STATUS_LENGTH
    ? chars.slice(0, MAX_AGENT_STATUS_LENGTH).join('')
    : cleaned
}

/** A card title as `board create` and `board rename` take it: escapes removed, one line, trimmed. */
export function cleanCardTitle(text: string): string {
  return stripEscapes(text).replace(/\s+/g, ' ').trim()
}

export const TITLE_REQUIRED = 'board: a title is required'

/** The refusal for `board status` on a card that isn't running (#9 D8). */
export function notRunningError(card: Card): string {
  return `board: "${card.title}" is not running`
}

/** The refusal for `board setup` on a card that isn't running or has no pending setup (#39 D4). */
export function noSetupError(card: Card): string {
  return `board: ${card.title} has no setup running`
}
