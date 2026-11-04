/**
 * Opening the Agent tab's files (#79 D2, D10): main opens or reveals only a path the last summary
 * it sent for that session listed, and only while it is still a regular file (as Agent setup's
 * `ListedPaths`, #68 S6). Paths travel as the summary gave them (`~/…` or absolute); main expands
 * them. Plain TS: main injects Electron's `shell.openPath` and `shell.showItemInFolder`.
 */
import type { AgentSummaryRead } from './agent-tab'
import { isSessionId } from './agent-tab'
import { isOutputFile, outputFilePath, type OutputFs } from './agent-transcript'
import type { OpenResult } from './open-result'

/** The file outputs each session's last summary listed: the path as given, and on disk. */
export class ListedOutputs {
  private readonly bySession = new Map<string, ReadonlyMap<string, string>>()

  /** Takes a reply sent for `sessionId`: a conversation replaces its set, `none` clears it. */
  record(sessionId: string, read: AgentSummaryRead, home: string): void {
    const key = sessionId.toLowerCase()
    if (read.state === 'none') this.bySession.delete(key)
    if (read.state !== 'conversation') return
    const paths = new Map<string, string>()
    for (const output of read.summary.outputs ?? []) {
      if (output.kind !== 'file') continue
      const path = outputFilePath(output.path, home)
      if (path !== null) paths.set(output.path, path)
    }
    this.bySession.set(key, paths)
  }

  /** The path on disk of `path` as the session's last summary gave it; null when it didn't. */
  path(sessionId: unknown, path: unknown): string | null {
    if (!isSessionId(sessionId) || typeof path !== 'string') return null
    return this.bySession.get(sessionId.toLowerCase())?.get(path) ?? null
  }
}

export interface OutputActionDeps {
  listed: ListedOutputs
  /** Electron's `shell.openPath`: '' once opened, else the error. */
  openPath: (path: string) => Promise<string>
  /** Electron's `shell.showItemInFolder`. */
  reveal: (path: string) => void
  fs?: OutputFs
}

/** Opens a listed file with the OS default app (D2); `refused` and nothing run otherwise. */
export async function openListedOutput(
  sessionId: unknown,
  path: unknown,
  deps: Omit<OutputActionDeps, 'reveal'>
): Promise<OpenResult> {
  const file = deps.listed.path(sessionId, path)
  if (file === null || !(await isOutputFile(file, deps.fs))) return { ok: false, reason: 'refused' }
  const error = await deps.openPath(file)
  return error === '' ? { ok: true } : { ok: false, reason: 'failed', message: error }
}

/** Shows a listed file in the OS file manager (D2); false (nothing shown) otherwise. */
export async function revealListedOutput(
  sessionId: unknown,
  path: unknown,
  deps: Omit<OutputActionDeps, 'openPath'>
): Promise<boolean> {
  const file = deps.listed.path(sessionId, path)
  if (file === null || !(await isOutputFile(file, deps.fs))) return false
  deps.reveal(file)
  return true
}
