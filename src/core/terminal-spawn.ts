import type { SpawnResult } from '../shared/api'
import { SPAWN_REFUSAL, isValidSize, workingDirectoryProblem } from './ipc-guards'
import type { StatFs } from './directories'
import type { SessionInfo } from './session-manager'

export interface SpawnRequest {
  cols: unknown
  rows: unknown
  cwd: unknown
}

export type StartSession = (options: { cols: number; rows: number; cwd: string }) => SessionInfo

export interface SpawnChecks {
  /** False once the page that asked has gone (reload, navigation, closed window). */
  stillCurrent?: () => boolean
  fs?: StatFs
}

const SPAWN_FAILED = 'the shell could not be started'
const PAGE_GONE = 'window reloaded'

/**
 * Checks a renderer's `terminal:spawn` arguments, then starts the session in `cwd` (#4 D3, D18).
 * Never throws: a refusal or spawn failure comes back as a reason the renderer can show.
 * The page is re-checked after the directory check, so a reloaded page never gets an orphan shell (D16).
 */
export async function spawnInDirectory(
  { cols, rows, cwd }: SpawnRequest,
  start: StartSession,
  { stillCurrent = () => true, fs }: SpawnChecks = {}
): Promise<SpawnResult> {
  if (!isValidSize(cols, rows)) return { ok: false, reason: SPAWN_REFUSAL.invalidSize }
  const problem = await workingDirectoryProblem(cwd, fs)
  if (problem !== null) return { ok: false, reason: problem }
  if (!stillCurrent()) return { ok: false, reason: PAGE_GONE }
  try {
    const { id } = start({ cols: cols as number, rows: rows as number, cwd: cwd as string })
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : ''
    return { ok: false, reason: message || SPAWN_FAILED }
  }
}
