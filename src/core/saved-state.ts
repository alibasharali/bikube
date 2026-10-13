/**
 * The saved-state file format (#8 D2, D3, D4). Plain TS: no Electron or Node imports, so main
 * and the renderer can both use it. The file holds `{ "version": 1, "state": WorkspaceState }`.
 */
import { checkStartup, type StartupCommand } from './startup-command'
import type { Card, Column, Workspace, WorkspaceState } from './workspace-store'

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
  if (!Number.isInteger(nextCardNumber) || (nextCardNumber as number) < 1)
    return 'bad nextCardNumber'
  const defaultStartup = readStartup(raw.defaultStartup)
  if (!defaultStartup) return 'bad default startup command'
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) return 'bad columns'
  const columns: Column[] = []
  for (const c of raw.columns) {
    if (!isObject(c) || !isId(c.id) || !isText(c.name)) return 'bad column'
    columns.push({ id: c.id, name: c.name })
  }
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
    columns,
    cards,
    nextCardNumber: nextCardNumber as number,
    defaultStartup
  }
}

/** The card, or why it is rejected. */
function readCard(raw: unknown): Card | string {
  if (!isObject(raw)) return 'card is not an object'
  const { id, columnId, title, directory, agentSessionId, claudeStarted } = raw
  if (!isId(id) || !isId(columnId) || !isText(title) || !isText(directory)) return 'bad card'
  if (!isId(agentSessionId) || typeof claudeStarted !== 'boolean') return 'bad card session'
  const startup = readStartup(raw.startup)
  if (!startup) return 'bad startup command'
  return { id, columnId, title, directory, startup, agentSessionId, claudeStarted }
}

/** A startup command that passes `checkStartup`, normalized by it; null otherwise. */
function readStartup(raw: unknown): StartupCommand | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'shell' || raw.kind === 'claude') return { kind: raw.kind }
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
