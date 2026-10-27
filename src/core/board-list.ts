/**
 * What `board list` prints: the calling card's workspace (or the one `--workspace` names, #69
 * D6), its columns in order and each column's cards top to bottom, with each card's id and
 * runtime state, as lines for a person or as JSON for a program (an agent reading the board
 * before it creates cards); and what `board workspaces` prints. Plain TS.
 */
import type { Activity } from './activity'
import { cardsInColumn, type Workspace, type WorkspaceState } from './workspace-store'

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
  /** It has a task description (#69 D7). */
  hasDescription?: true
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
        if (card.description) listed.hasDescription = true
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
      const described = card.hasDescription ? ' · description' : ''
      lines.push(`  ${card.title}  [${card.id}]  ${details.join(', ')}${described}`)
      if (card.status) lines.push(`    status: ${card.status}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** A workspace as `board workspaces` lists it (#69 D6). */
export interface ListedWorkspace {
  id: string
  name: string
  location: 'local' | 'ssh'
  /** An SSH workspace's host. */
  host?: string
  directory: string
  /** The calling card's workspace. */
  current?: true
}

/** Every workspace in sidebar order, the one holding the calling card marked `current`. */
export function workspacesListing(
  state: WorkspaceState,
  callingWorkspaceId: string
): ListedWorkspace[] {
  return state.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    location: w.host === undefined ? 'local' : 'ssh',
    ...(w.host !== undefined && { host: w.host }),
    directory: w.directory,
    ...(w.id === callingWorkspaceId && { current: true as const })
  }))
}

/** The listing as lines: `<id>  <name>  local|ssh <host>  <directory>`, `  *` on the current. */
export function formatWorkspacesListing(listing: readonly ListedWorkspace[]): string {
  return listing
    .map((w) => {
      const where = w.location === 'local' ? 'local' : `ssh ${w.host}`
      return `${w.id}  ${w.name}  ${where}  ${w.directory}${w.current ? '  *' : ''}\n`
    })
    .join('')
}
