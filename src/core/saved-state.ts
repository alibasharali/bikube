/**
 * The saved-state file format (#8 D2, D3, D4). Plain TS: no Electron or Node imports, so main
 * and the renderer can both use it. The file holds `{ "version": 1, "state": WorkspaceState }`.
 */
import { isAgentKind, type AgentKind } from './agent-presets'
import { readAutoMove } from './auto-move'
import { checkHost, checkRemoteDirectory } from './ssh-location'
import { checkStartup, type StartupCommand } from './startup-command'
import { isWorkspaceLogo } from './workspace-logos'
import {
  checkShell,
  checkWorktreeSetup,
  isShellType,
  type Card,
  type CardWorktree,
  type Column,
  type Workspace,
  type WorkspaceShell,
  type WorkspaceState
} from './workspace-store'

export const STATE_FILE_NAME = 'drovr-state.json'
export const SAVED_STATE_VERSION = 1

export type SavedStateResult = { ok: true; value: WorkspaceState } | { ok: false; reason: string }

/** The file contents for `state`. */
export function serializeSavedState(state: WorkspaceState): string {
  return JSON.stringify({ version: SAVED_STATE_VERSION, state })
}

/** Parses the file's contents; anything but a valid version-1 file is rejected (D3). */
export function parseSavedState(text: string): SavedStateResult {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return reject('not JSON')
  }
  if (!isObject(file)) return reject('not an object')
  if (file.version !== SAVED_STATE_VERSION) return reject('unsupported version')
  return validateWorkspaceState(file.state)
}

/** The name the rejected file is renamed to (D4), with `now` as a UTC timestamp. */
export function corruptFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  return `drovr-state.corrupt-${stamp}.json`
}

/**
 * Checks an already-parsed value (the file's `state`, or the `state:save` payload) against
 * D1 and D3 and returns a copy holding only the fields of D1. Ids must be unique across
 * workspaces, columns and cards together. Nothing is repaired: one broken invariant rejects
 * the whole value.
 */
export function validateWorkspaceState(value: unknown): SavedStateResult {
  if (!isObject(value) || !Array.isArray(value.workspaces)) return reject('no workspaces')
  const ids = new Set<string>()
  const workspaces: Workspace[] = []
  for (const raw of value.workspaces) {
    const ws = readWorkspace(raw)
    if (typeof ws === 'string') return reject(ws)
    for (const id of [ws.id, ...ws.columns.map((c) => c.id), ...ws.cards.map((c) => c.id)]) {
      if (ids.has(id)) return reject('duplicate id')
      ids.add(id)
    }
    workspaces.push(ws)
  }
  const activeId = value.activeId
  if (activeId === null) {
    if (workspaces.length > 0) return reject('no active workspace')
  } else if (typeof activeId !== 'string' || !workspaces.some((w) => w.id === activeId)) {
    return reject('active workspace not found')
  }
  return { ok: true, value: { workspaces, activeId } }
}

/** The workspace, or why it is rejected. */
function readWorkspace(raw: unknown): Workspace | string {
  if (!isObject(raw)) return 'workspace is not an object'
  const { id, name, directory, nextCardNumber } = raw
  if (!isId(id) || !isText(name) || !isText(directory)) return 'bad workspace'
  const host = readHost(raw.host, directory)
  if (typeof host !== 'object') return host
  if (!Number.isInteger(nextCardNumber) || (nextCardNumber as number) < 1)
    return 'bad nextCardNumber'
  const startup = readStartup(raw.defaultStartup)
  if (!startup) return 'bad default startup command'
  // Cards are agent sessions now: a workspace defaulting to a plain shell defaults to Claude Code.
  const defaultStartup: StartupCommand = startup.kind === 'shell' ? { kind: 'claude' } : startup
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) return 'bad columns'
  const columns: Column[] = []
  for (const c of raw.columns) {
    if (!isObject(c) || !isId(c.id) || !isText(c.name)) return 'bad column'
    columns.push({ id: c.id, name: c.name })
  }
  const shells = readShells(raw.shells)
  if (typeof shells === 'string') return shells
  // Missing, as in files from before #39, is none.
  const rawSetup = raw.worktreeSetup ?? ''
  if (typeof rawSetup !== 'string') return 'bad worktree setup'
  const setup = checkWorktreeSetup(rawSetup)
  if (!setup.ok || setup.value !== rawSetup) return 'bad worktree setup'
  // Missing is none (#59 D2); an id this version doesn't know, from a newer one, is none too (D5).
  if (raw.logo !== undefined && typeof raw.logo !== 'string') return 'bad logo'
  const logo = isWorkspaceLogo(raw.logo) ? { logo: raw.logo } : {}
  // Missing is every rule off; a rule naming a column this workspace lacks is off (#42 D7).
  const autoMove = readAutoMove(
    raw.autoMove,
    columns.map((c) => c.id)
  )
  if (autoMove === 'bad') return 'bad autoMove'
  if (!Array.isArray(raw.cards)) return 'bad cards'
  const cards: Card[] = []
  for (const c of raw.cards) {
    const card = readCard(c)
    if (typeof card === 'string') return card
    if (!columns.some((col) => col.id === card.columnId)) return 'card in unknown column'
    cards.push(card)
  }
  return {
    id,
    name,
    directory,
    ...host,
    ...logo,
    columns,
    cards,
    nextCardNumber: nextCardNumber as number,
    defaultStartup,
    shells,
    worktreeSetup: setup.value,
    ...(autoMove !== null && { autoMove })
  }
}

/** The workspace's shells; missing, as in files from before shells, is none. */
function readShells(raw: unknown): WorkspaceShell[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'bad shells'
  const shells: WorkspaceShell[] = []
  for (const s of raw) {
    if (!isObject(s) || !isId(s.id) || typeof s.name !== 'string') return 'bad shell'
    const command = typeof s.command === 'string' ? s.command : ''
    const checked = checkShell({
      name: s.name,
      command,
      autostart: s.autostart === true,
      // Before types: a shell with a command and Close when the command stops or Start in the
      // background set is a trigger.
      type: isShellType(s.type)
        ? s.type
        : (s.autoClose === true || s.background === true) && command.trim()
          ? 'trigger'
          : 'shell'
    })
    if (!checked.ok || checked.value.name !== s.name) return 'bad shell'
    if (shells.some((other) => other.id === s.id)) return 'duplicate shell'
    shells.push({ id: s.id, ...checked.value, ...(isId(s.runIn) && { runIn: s.runIn }) })
  }
  return shells
}

/** The card, or why it is rejected. */
function readCard(raw: unknown): Card | string {
  if (!isObject(raw)) return 'card is not an object'
  const { id, columnId, title, directory, agentSessionId, claudeStarted } = raw
  if (!isId(id) || !isId(columnId) || !isText(title) || !isText(directory)) return 'bad card'
  const host = readHost(raw.host, directory)
  if (typeof host !== 'object') return host
  if (!isId(agentSessionId) || typeof claudeStarted !== 'boolean') return 'bad card session'
  const startup = readStartup(raw.startup)
  if (!startup) return 'bad startup command'
  const startedAgents = readStartedAgents(raw.startedAgents)
  if (!startedAgents) return 'bad started agents'
  const worktree = readWorktree(raw.worktree, host.host)
  if (typeof worktree !== 'object') return worktree
  const setup = readCardSetup(raw.setup)
  if (typeof setup !== 'object') return setup
  return {
    id,
    columnId,
    title,
    directory,
    ...host,
    ...worktree,
    startup,
    agentSessionId,
    claudeStarted,
    startedAgents,
    ...setup
  }
}

/** `{}` without a pending setup; `{ setup }` for one trimmed, non-empty line (#39 D2, D8). */
function readCardSetup(raw: unknown): { setup?: string } | string {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'string' || !raw) return 'bad card setup'
  const checked = checkWorktreeSetup(raw)
  if (!checked.ok || checked.value !== raw) return 'bad card setup'
  return { setup: raw }
}

/** `{}` without a worktree; `{ worktree }` for a local card's valid one; else why it is rejected. */
function readWorktree(
  raw: unknown,
  host: string | undefined
): { worktree?: CardWorktree } | string {
  if (raw === undefined || raw === null) return {}
  if (!isObject(raw) || host !== undefined) return 'bad worktree'
  const { path, branch, repo } = raw
  if (!isText(path) || !isText(branch) || !isText(repo)) return 'bad worktree'
  return { worktree: { path, branch, repo } }
}

/** Distinct preset kinds (#21 D6); missing, as in files from before #21, is none. Null otherwise. */
function readStartedAgents(raw: unknown): AgentKind[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(isAgentKind)) return null
  return new Set(raw).size === raw.length ? [...raw] : null
}

/**
 * `{}` for a local workspace or card (no host, or null), `{ host }` for an SSH one whose host
 * passes D2 and whose directory passes D3 unchanged (#12 D10), else why it is rejected.
 */
function readHost(raw: unknown, directory: string): { host?: string } | string {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'string') return 'bad host'
  const host = checkHost(raw)
  if (!host.ok || host.value !== raw) return 'bad host'
  const remote = checkRemoteDirectory(directory)
  if (!remote.ok || remote.value !== directory) return 'bad remote directory'
  return { host: host.value }
}

/** A startup command that passes `checkStartup`, normalized by it; null otherwise. */
function readStartup(raw: unknown): StartupCommand | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'shell' || raw.kind === 'claude' || isAgentKind(raw.kind))
    return { kind: raw.kind }
  if (raw.kind !== 'custom' || typeof raw.command !== 'string') return null
  const checked = checkStartup({ kind: 'custom', command: raw.command })
  return checked.ok ? checked.value : null
}

const reject = (reason: string): SavedStateResult => ({ ok: false, reason })

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** Non-empty after trimming, as names, titles and directories always are. */
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
