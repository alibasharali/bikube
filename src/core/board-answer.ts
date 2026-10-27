/**
 * The renderer's answer to a `board` request (#9 D10): it resolves the card and column against
 * its store, applies the change, and answers with the reply the CLI prints. Plain TS.
 */
import type { Activity } from './activity'
import type { BoardCommand, SetupResult } from './board-args'
import {
  boardListing,
  formatBoardListing,
  formatWorkspacesListing,
  workspacesListing,
  type CardRuntime
} from './board-list'
import {
  ACROSS_WORKSPACES,
  agentStartup,
  inheritedStartup,
  placedIn,
  resolveAnyCard,
  resolveWorkspace,
  servesRemoteCard,
  boardMoveTarget,
  cleanAgentStatus,
  cleanCardTitle,
  TITLE_REQUIRED,
  findCallingWorkspace,
  noSetupError,
  notRunningError,
  resolveCard,
  resolveColumn
} from './board-commands'
import { INVALID_REQUEST, type BoardReply } from './board-protocol'
import type { ClaudeUsage } from './claude-usage-types'
import type { Card, WorkspaceState, WorkspaceStore } from './workspace-store'
import { branchProblem, suggestBranch } from './worktree-names'

/** The local branches of the repository a folder is in, or null outside one (main's `worktree.info`). */
export type RepoBranches = (dir: string) => Promise<{ branches: string[] } | null>

/**
 * `board create --worktree`'s checks (#69 D10), run before the card is created since they ask
 * git: the target workspace must be local and inside a git repository, and the branch (the one
 * given, else `suggestBranch`'s from the title, free among the repository's branches) must be a
 * valid name, checked before git is asked, that doesn't exist yet. Answers with the command,
 * its `branch` filled in, or the reason to refuse it with. Any other command, and a create the
 * board refuses anyway (no calling card, an SSH card's, no title), comes back as it is.
 */
export async function checkCreateWorktree(
  state: WorkspaceState,
  callingCardId: string,
  command: BoardCommand,
  repoBranches: RepoBranches
): Promise<{ ok: true; command: BoardCommand } | { ok: false; error: string }> {
  const unchanged = { ok: true as const, command }
  if (command.command !== 'create' || !command.worktree) return unchanged
  const calling = findCallingWorkspace(state, callingCardId)
  if (!calling.ok) return unchanged
  if (calling.value.cards.find((c) => c.id === callingCardId)?.host !== undefined) return unchanged
  const title = cleanCardTitle(command.title)
  if (!title) return unchanged
  const target =
    command.workspace !== undefined ? resolveWorkspace(state, command.workspace) : calling
  if (!target.ok) return target
  const ws = target.value
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  if (ws.host !== undefined) return { ok: false, error: `board: ${ws.name} is an SSH workspace` }
  if (command.branch !== undefined) {
    const problem = branchProblem(command.branch)
    if (problem) return { ok: false, error: `board: ${problem}` }
  }
  const repo = await repoBranches(ws.directory)
  if (!repo) return { ok: false, error: `board: ${ws.directory} is not in a git repository` }
  const branch = command.branch ?? suggestBranch(title, new Set(repo.branches))
  if (repo.branches.includes(branch)) {
    return { ok: false, error: `board: a branch named '${branch}' already exists` }
  }
  return { ok: true, command: { ...command, branch } }
}

/**
 * Applies `command` for the calling card (#9 D2, D7, D8). A move goes to the bottom of the
 * column through the store, so it is saved like any board change (#8 D6). `status` needs a
 * running card and hands the cleaned text to `setAgentStatus` (#9 D8), which shows it, and keeps
 * it in the store as the card's last status, shown once it stops;
 * `activity` likewise hands its value to `setActivity`, null for `none` (#31 D12). `setup` acts
 * only on the calling card, which must be running with a pending setup (#39 D4): `ok` clears it in the store (saved) and hands the
 * card as it now is to `setupAnswered`, which types its start line; `failed` keeps it. `usage`
 * needs a running card and hands the usage to `setUsage`, also keeping it in the store as the
 * card's last usage, so it is there after a restart (#50 D5, D7).
 * `list` answers with the workspace's columns and cards (`runtime` gives each card's state);
 * `create` adds a card, not started, at the bottom of a column and answers with its id; `rename`
 * renames one. Both save through the store like any board change. `description` answers with
 * the card's description and one newline, or nothing; `describe` replaces it through the store,
 * which trims it, removes it when empty and refuses one over the cap (#69 D5).
 */
export function answerBoardCommand(
  store: Pick<
    WorkspaceStore,
    | 'getState'
    | 'moveCard'
    | 'setAgentSession'
    | 'clearCardSetup'
    | 'createCard'
    | 'renameCard'
    | 'setCardLastStatus'
    | 'setCardLastUsage'
    | 'setCardDescription'
  >,
  callingCardId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  setAgentStatus: (cardId: string, text: string) => void,
  setActivity: (cardId: string, activity: Activity | null) => void = () => {},
  setupAnswered: (card: Card, result: SetupResult) => void = () => {},
  setUsage: (cardId: string, usage: ClaudeUsage) => void = () => {},
  runtime: (cardId: string) => CardRuntime = (id) => ({ running: isRunning(id) })
): BoardReply {
  const state = store.getState()
  const workspace = findCallingWorkspace(state, callingCardId)
  if (!workspace.ok) return workspace
  const calling = workspace.value
  const callingCard = calling.cards.find((c) => c.id === callingCardId) as Card
  // An SSH card's session socket serves only its own card's workspace (#69 D9).
  const remote = callingCard.host !== undefined
  if (remote && !servesRemoteCard(command)) return { ok: false, error: INVALID_REQUEST }
  if (command.command === 'workspaces') {
    const listing = workspacesListing(state, calling.id)
    const output =
      command.format === 'json'
        ? `${JSON.stringify(listing, null, 2)}\n`
        : formatWorkspacesListing(listing)
    return { ok: true, output }
  }
  // Titles resolve in the workspace `--workspace` names, else the calling card's (#69 D6, D7).
  let titles = calling
  if ('workspace' in command && command.workspace !== undefined) {
    const named = resolveWorkspace(state, command.workspace)
    if (!named.ok) return named
    titles = named.value
  }
  if (command.command === 'list') {
    const listing = boardListing(titles, callingCardId, runtime)
    const output =
      command.format === 'json'
        ? `${JSON.stringify(listing, null, 2)}\n`
        : formatBoardListing(listing)
    return { ok: true, output }
  }
  if (command.command === 'create') {
    const title = cleanCardTitle(command.title)
    if (!title) return { ok: false, error: TITLE_REQUIRED }
    const column = resolveColumn(titles, command.column)
    if (!column.ok) return column
    // Its branch is filled in by `checkCreateWorktree`, which must have run (#69 D10).
    if (command.worktree && command.branch === undefined) {
      return { ok: false, error: INVALID_REQUEST }
    }
    const startup =
      command.agent !== undefined ? agentStartup(command.agent) : inheritedStartup(callingCard)
    const created = store.createCard(
      titles.id,
      column.value.id,
      title,
      startup,
      undefined,
      command.description,
      {
        unopened: titles.id !== calling.id,
        allowShell: command.agent === 'shell',
        ...(command.worktree &&
          command.branch !== undefined && { pendingWorktree: { branch: command.branch } })
      }
    )
    if (!created.ok) return { ok: false, error: `board: ${created.error.message}` }
    return { ok: true, output: `${created.value.id} ${titles.name}\n` }
  }
  // A card's id names it in any workspace for a local card (#69 D7); `activity`, `session`,
  // `setup` and `usage` stay in the calling workspace, as an SSH card's commands do (D9).
  const placed =
    remote || !ACROSS_WORKSPACES.has(command.command)
      ? placedIn(calling, resolveCard(calling, callingCardId, command.card))
      : resolveAnyCard(state, titles, callingCardId, command.card)
  if (!placed.ok) return placed
  const ws = placed.value.workspace
  const card = { ok: true as const, value: placed.value.card }
  if (command.command === 'description') {
    const { description } = card.value
    return description ? { ok: true, output: `${description}\n` } : { ok: true }
  }
  if (command.command === 'describe') {
    const set = store.setCardDescription(ws.id, card.value.id, command.description)
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (command.command === 'status') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    const text = cleanAgentStatus(command.text)
    setAgentStatus(card.value.id, text)
    store.setCardLastStatus(ws.id, card.value.id, text)
    return { ok: true }
  }
  if (command.command === 'rename') {
    const title = cleanCardTitle(command.title)
    if (!title) return { ok: false, error: TITLE_REQUIRED }
    const renamed = store.renameCard(ws.id, card.value.id, title)
    return renamed.ok ? { ok: true } : { ok: false, error: `board: ${renamed.error.message}` }
  }
  if (command.command === 'session') {
    // Bikube's Claude hooks: the session this card resumes from now on (a message sent, a /resume).
    const set = store.setAgentSession(ws.id, card.value.id, command.session.toLowerCase())
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (command.command === 'setup') {
    // Only the calling card's own setup (D4): another card's reads as having none.
    if (card.value.id !== callingCardId || !isRunning(card.value.id) || !card.value.setup) {
      return { ok: false, error: noSetupError(card.value) }
    }
    if (command.result === 'failed') {
      setupAnswered(card.value, 'failed')
      return { ok: true }
    }
    const cleared = store.clearCardSetup(ws.id, card.value.id)
    if (!cleared.ok) return { ok: false, error: `board: ${cleared.error.message}` }
    setupAnswered(cleared.value, 'ok')
    return { ok: true }
  }
  if (command.command === 'usage') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setUsage(card.value.id, command.usage)
    store.setCardLastUsage(ws.id, card.value.id, command.usage)
    return { ok: true }
  }
  if (command.command === 'activity') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setActivity(card.value.id, command.activity === 'none' ? null : command.activity)
    return { ok: true }
  }
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  const target = boardMoveTarget(ws, card.value, column.value.id)
  if (!target) return { ok: true }
  const moved = store.moveCard(ws.id, card.value.id, target.columnId, target.index)
  return moved.ok ? { ok: true } : { ok: false, error: `board: ${moved.error.message}` }
}
