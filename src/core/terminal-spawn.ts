import type { SpawnResult } from '../shared/api'
import { SPAWN_REFUSAL, isValidSize, workingDirectoryProblem } from './ipc-guards'
import type { StatFs } from './directories'
import type { SessionInfo } from './session-manager'
import { sshShellLine } from './ssh-command'

export interface SpawnRequest {
  cols: unknown
  rows: unknown
  cwd: unknown
  /** The card's SSH host (#12 D12); null or absent for a local card. */
  host?: unknown
}

/**
 * How to start the checked session: a local login shell in `cwd`, or for an SSH card (#12 D5) a
 * login shell in the home directory running `command`, which gets none of the `board` variables.
 */
export type StartOptions =
  | { cols: number; rows: number; cwd: string; command?: undefined }
  | { cols: number; rows: number; command: string; cwd?: undefined }

export type StartSession = (options: StartOptions) => SessionInfo

export interface SpawnChecks {
  /** False once the page that asked has gone (reload, navigation, closed window). */
  stillCurrent?: () => boolean
  fs?: StatFs
}

const SPAWN_FAILED = 'the shell could not be started'
const PAGE_GONE = 'window reloaded'

/**
 * Checks a renderer's `terminal:spawn` arguments, then starts the session in `cwd` (#4 D3, D18),
 * or for a card with a host its SSH line (#12 D5), refusing a host failing D2 or a directory
 * failing D3 (#12 D12); a remote directory is never checked locally.
 * Never throws: a refusal or spawn failure comes back as a reason the renderer can show.
 * The page is re-checked after the directory check, so a reloaded page never gets an orphan shell (D16).
 */
export async function spawnInDirectory(
  { cols, rows, cwd, host }: SpawnRequest,
  start: StartSession,
  { stillCurrent = () => true, fs }: SpawnChecks = {}
): Promise<SpawnResult> {
  if (!isValidSize(cols, rows)) return { ok: false, reason: SPAWN_REFUSAL.invalidSize }
  let options: StartOptions
  if (host === null || host === undefined) {
    const problem = await workingDirectoryProblem(cwd, fs)
    if (problem !== null) return { ok: false, reason: problem }
    options = { cols: cols as number, rows: rows as number, cwd: cwd as string }
  } else {
    const ssh = sshShellLine(host, cwd)
    if (!ssh.ok) return { ok: false, reason: ssh.reason }
    options = { cols: cols as number, rows: rows as number, command: ssh.line }
  }
  if (!stillCurrent()) return { ok: false, reason: PAGE_GONE }
  try {
    const { id } = start(options)
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : ''
    return { ok: false, reason: message || SPAWN_FAILED }
  }
}
