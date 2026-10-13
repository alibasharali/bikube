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

const SPAWN_FAILED = 'the shell could not be started'

/**
 * Checks a renderer's `terminal:spawn` arguments, then starts the session in `cwd` (#4 D3, D18).
 * Never throws: a refusal or spawn failure comes back as a reason the renderer can show.
 */
export async function spawnInDirectory(
  { cols, rows, cwd }: SpawnRequest,
  start: StartSession,
  fsImpl?: StatFs
): Promise<SpawnResult> {
  if (!isValidSize(cols, rows)) return { ok: false, reason: SPAWN_REFUSAL.invalidSize }
  const problem = await workingDirectoryProblem(cwd, fsImpl)
  if (problem !== null) return { ok: false, reason: problem }
  try {
    const { id, pid } = start({ cols: cols as number, rows: rows as number, cwd: cwd as string })
    return { ok: true, id, pid }
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : ''
    return { ok: false, reason: message || SPAWN_FAILED }
  }
}
