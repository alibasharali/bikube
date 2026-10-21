/**
 * What `board list` prints: the calling card's workspace, its columns in order and each column's
 * cards top to bottom, with each card's id and runtime state, as lines for a person or as JSON
 * for a program (an agent reading the board before it creates cards). Plain TS.
 */
import type { Activity } from './activity'
import { cardsInColumn, type Workspace } from './workspace-store'

/** A card's runtime state, which the store doesn't keep. */
export interface CardRuntime {
  running: boolean
  activity?: Activity
  /** The status text an agent set with `board status`. */
  status?: string
}

export interface ListedCard {
  id: string
  title: string
  state: 'running' | 'stopped'
  activity?: Activity
  status?: string
  /** A worktree card's branch. */
  branch?: string
  /** The calling card. */
  self?: true
}

export interface BoardListing {
  workspace: { id: string; name: string; directory: string; host?: string }
  columns: { id: string; name: string; cards: ListedCard[] }[]
}

export function boardListing(
  workspace: Workspace,
  callingCardId: string,
  runtime: (cardId: string) => CardRuntime
): BoardListing {
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      directory: workspace.directory,
      ...(workspace.host !== undefined && { host: workspace.host })
    },
    columns: workspace.columns.map((column) => ({
      id: column.id,
      name: column.name,
      cards: cardsInColumn(workspace, column.id).map((card) => {
        const state = runtime(card.id)
        const listed: ListedCard = {
          id: card.id,
          title: card.title,
          state: state.running ? 'running' : 'stopped'
        }
        if (state.running && state.activity) listed.activity = state.activity
        if (state.running && state.status) listed.status = state.status
        if (card.worktree) listed.branch = card.worktree.branch
        if (card.id === callingCardId) listed.self = true
        return listed
      })
    }))
  }
}

/**
 * The listing as lines: the workspace, then each column with its count and its cards indented,
 * each as `<title>  [<id>]` and its state, the caller's marked `this card`.
 */
export function formatBoardListing(listing: BoardListing): string {
  const { workspace } = listing
  const where =
    workspace.host === undefined ? workspace.directory : `${workspace.host}:${workspace.directory}`
  const lines = [`${workspace.name} (${where})`]
  for (const column of listing.columns) {
    lines.push('', `${column.name} (${column.cards.length})`)
    for (const card of column.cards) {
      const details: string[] = [card.state]
      if (card.activity) details.push(card.activity)
      if (card.branch) details.push(`branch ${card.branch}`)
      if (card.self) details.push('this card')
      lines.push(`  ${card.title}  [${card.id}]  ${details.join(', ')}`)
      if (card.status) lines.push(`    status: ${card.status}`)
    }
  }
  return `${lines.join('\n')}\n`
}
