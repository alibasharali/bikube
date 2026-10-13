/** Delete rules for cards, columns and workspaces with cards (#4 D13, D14, D15). Plain TS. */
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

/** How many of `cards` have a running process. */
export function runningCount(
  cards: readonly { id: string }[],
  runState: (cardId: string) => CardRunState | undefined
): number {
  return cards.filter((c) => runState(c.id)?.kind === 'running').length
}

/** The workspace delete confirmation; it names the running terminals when there are any. */
export function workspaceDeleteMessage(name: string, running: number): string {
  const base = `Delete "${name}"? This removes its board.`
  if (running === 0) return base
  const terminals = running === 1 ? '1 terminal is' : `${running} terminals are`
  return `${base} ${terminals} still running and will be stopped.`
}
