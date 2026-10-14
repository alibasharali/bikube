/**
 * The sync file's format (#13 D3, D5, D6). Plain TS: no Electron or Node imports. The file
 * `drovr-board.json` in the sync folder holds
 * `{ "version": 1, "savedAt": "<ISO 8601 UTC>", "board": { "workspaces": [...] } }`.
 */

import { validateWorkspaceState } from './saved-state'
import type { StartupCommand } from './startup-command'
import type { Workspace, WorkspaceState } from './workspace-store'

export const SYNC_FILE_NAME = 'drovr-board.json'

/** `home` without trailing separators (but `/` stays `/`). */
function trimHome(home: string): string {
  const trimmed = home.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * A local directory as the sync file holds it (D5): this machine's home as `~`, a path under it as
 * `~/<rest>`, any other path as it is.
 */
export function portableDirectory(directory: string, home: string): string {
  const h = trimHome(home)
  const dir = directory.length > 1 ? directory.replace(/\/+$/, '') : directory
  if (dir === h) return '~'
  const prefix = h === '/' ? '/' : `${h}/`
  if (dir.startsWith(prefix)) return `~/${dir.slice(prefix.length)}`
  return directory
}

/** A local directory as read from the sync file (D5): `~` and `~/<rest>` under this machine's home. */
export function expandHome(directory: string, home: string): string {
  const h = trimHome(home)
  if (directory === '~') return h
  if (directory.startsWith('~/')) return `${h === '/' ? '' : h}/${directory.slice(2)}`
  return directory
}

export const SYNC_FILE_VERSION = 1

/** D3's `board`: every workspace as the file holds it, with no active workspace (D2). */
export interface SyncBoard {
  workspaces: Workspace[]
}

/**
 * The board this machine writes (D2, D5, D6): local directories mapped by `portableDirectory`,
 * local cards with `claudeStarted` false and `startedAgents` empty (#21 D7), SSH ones as they are. Objects are rebuilt with a fixed
 * key order, so the same board always serializes to the same text (D4 compares it).
 */
export function toSyncBoard(state: WorkspaceState, home: string): SyncBoard {
  const dir = (directory: string, host: string | undefined): string =>
    host === undefined ? portableDirectory(directory, home) : directory
  return {
    workspaces: state.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      directory: dir(w.directory, w.host),
      ...(w.host !== undefined && { host: w.host }),
      columns: w.columns.map((c) => ({ id: c.id, name: c.name })),
      cards: w.cards.map((c) => ({
        id: c.id,
        columnId: c.columnId,
        title: c.title,
        directory: dir(c.directory, c.host),
        ...(c.host !== undefined && { host: c.host }),
        startup: startupCopy(c.startup),
        agentSessionId: c.agentSessionId,
        claudeStarted: c.host === undefined ? false : c.claudeStarted,
        startedAgents: c.host === undefined ? [] : [...c.startedAgents]
      })),
      nextCardNumber: w.nextCardNumber,
      defaultStartup: startupCopy(w.defaultStartup)
    }))
  }
}

const startupCopy = (s: StartupCommand): StartupCommand =>
  s.kind === 'custom' ? { kind: 'custom', command: s.command } : { kind: s.kind }

/** The file contents for `board`, saved at `savedAt` (D3). */
export function serializeSyncFile(board: SyncBoard, savedAt: Date): string {
  return JSON.stringify({ version: SYNC_FILE_VERSION, savedAt: savedAt.toISOString(), board })
}

export type SyncFileResult = { ok: true; workspaces: Workspace[] } | { ok: false; reason: string }

/**
 * Reads the file's contents (D3): valid when it is JSON, `version` is 1, `savedAt` a valid date and
 * `board` passes the saved-state validation (#8 D3) once local directories are expanded under
 * `home` (D5); anything else is unreadable. Local cards come back with `claudeStarted` false and
 * `startedAgents` empty, as a card new to this machine gets them (D6, #21 D7).
 */
export function parseSyncFile(text: string, home: string): SyncFileResult {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not JSON' }
  }
  if (!isObject(file)) return { ok: false, reason: 'not an object' }
  if (file.version !== SYNC_FILE_VERSION) return { ok: false, reason: 'unsupported version' }
  if (typeof file.savedAt !== 'string' || Number.isNaN(Date.parse(file.savedAt)))
    return { ok: false, reason: 'bad savedAt' }
  const board = file.board
  if (!isObject(board) || !Array.isArray(board.workspaces))
    return { ok: false, reason: 'no workspaces' }
  const workspaces = board.workspaces.map((w) => expandItem(w, home))
  for (const w of workspaces) {
    if (isObject(w) && Array.isArray(w.cards)) w.cards = w.cards.map((c) => expandItem(c, home))
  }
  const first = workspaces[0]
  const activeId = isObject(first) ? first.id : null
  const checked = validateWorkspaceState({ workspaces, activeId })
  if (!checked.ok) return checked
  return {
    ok: true,
    workspaces: checked.value.workspaces.map((w) => ({
      ...w,
      cards: w.cards.map((c) =>
        c.host === undefined ? { ...c, claudeStarted: false, startedAgents: [] } : c
      )
    }))
  }
}

/** A shallow copy of a raw workspace or card with its local directory expanded (D5). */
function expandItem(raw: unknown, home: string): unknown {
  if (!isObject(raw)) return raw
  const local = raw.host === undefined || raw.host === null
  if (!local || typeof raw.directory !== 'string') return { ...raw }
  return { ...raw, directory: expandHome(raw.directory, home) }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The joined board when sync is turned on (D9): the file's workspaces in their order, then this
 * machine's workspaces whose id the file lacks, in their order. A workspace in both is the file's.
 */
export function joinBoards(fromFile: Workspace[], local: Workspace[]): Workspace[] {
  const inFile = new Set(fromFile.map((w) => w.id))
  return [...fromFile, ...local.filter((w) => !inFile.has(w.id))]
}
