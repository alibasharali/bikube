/**
 * Delete rules for cards, columns and workspaces with cards (#4 D13, D14, D15), and the close
 * confirmation for a running card (#7 D4). Plain TS.
 */
import type { CardRunState } from './card-status'
import { cardsInColumn, type Workspace } from './workspace-store'

/**
 * Whether the column menu's Delete is enabled, and the hint shown when it isn't. The last
 * column can never be deleted (no hint, as before); a column with cards needs them gone first.
 */
export function columnDeleteHint(
  workspace: Workspace,
  columnId: string
): { canDelete: boolean; hint: string | null } {
  if (workspace.columns.length <= 1) return { canDelete: false, hint: null }
  if (cardsInColumn(workspace, columnId).length > 0)
    return { canDelete: false, hint: 'Move or delete its cards first' }
  return { canDelete: true, hint: null }
}

/** The confirmation for deleting a card, or null when it can go at once (not running). */
export function cardDeleteConfirmation(
  title: string,
  state: CardRunState | undefined
): string | null {
  if (state?.kind !== 'running') return null
  return `Delete "${title}"? Its terminal is still running and will be stopped.`
}

/** The confirmation for closing a running card (#7 D4); Close is only offered while running. */
export function cardCloseConfirmation(title: string): string {
  return `Close "${title}"? Its terminal will be stopped. Open the card again to start it with its startup command.`
}

/** How many of `cards` have a running process. */
export function runningCount(
  cards: readonly { id: string }[],
  runState: (cardId: string) => CardRunState | undefined
): number {
  return cards.filter((c) => runState(c.id)?.kind === 'running').length
}

/** The workspace delete confirmation; it names the running terminals when there are any. */
export function workspaceDeleteMessage(name: string, running: number, worktrees = 0): string {
  const base = `Delete "${name}"? This removes its board.`
  const terminals = running === 1 ? '1 terminal is' : `${running} terminals are`
  const stopped = running === 0 ? '' : ` ${terminals} still running and will be stopped.`
  // A workspace's cards' worktrees are never removed with it: they may hold uncommitted work.
  const kept =
    worktrees === 0
      ? ''
      : ` ${worktrees === 1 ? "Its card's worktree is" : `Its cards' ${worktrees} worktrees are`} kept.`
  return `${base}${stopped}${kept}`
}
