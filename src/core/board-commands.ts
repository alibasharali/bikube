/**
 * Resolving `board` commands against the board (#9 D2, D7, D8). Plain TS: the renderer runs
 * these against its store and answers with the error text, which the CLI prints verbatim.
 */

import type { CardMoveTarget } from './card-moves'
import { stripEscapes } from './card-status'
import {
  cardsInColumn,
  type Card,
  type Column,
  type Workspace,
  type WorkspaceState
} from './workspace-store'

export type BoardResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const NOT_IN_A_CARD = 'board: not running inside a Drovr card'
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
