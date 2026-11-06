/**
 * Opening the Agent tab's files (#79 D2, D10): main opens or reveals only a path the last summary
 * it sent for that session listed, and only while it is still a regular file (as Agent setup's
 * `ListedPaths`, #68 S6). Paths travel as the summary gave them (`~/…` or absolute); main expands
 * them. Plain TS: main injects Electron's `shell.openPath` and `shell.showItemInFolder`.
 */
import { realpath } from 'node:fs/promises'
import { extname } from 'node:path'
import { OUTPUT_EXTENSIONS } from './agent-outputs'
import type { AgentSummaryRead } from './agent-tab'
import { isSessionId } from './agent-tab'
import { TAIL_DROP_MS, isOutputFile, outputFilePath, type OutputFs } from './agent-transcript'
import type { OpenResult } from './open-result'

/**
 * The file outputs each session's last summary listed: the path as given, and on disk; a session's
 * forgotten 60 s after its last reply, as the tailer drops its state.
 */
export class ListedOutputs {
  private readonly bySession = new Map<string, ReadonlyMap<string, string>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Takes a reply sent for `sessionId`: a conversation replaces its set, `none` clears it. */
  record(sessionId: string, read: AgentSummaryRead, home: string): void {
    const key = sessionId.toLowerCase()
    clearTimeout(this.timers.get(key))
    const timer = setTimeout(() => this.forget(key), TAIL_DROP_MS)
    timer.unref?.()
    this.timers.set(key, timer)
    if (read.state === 'none') this.forget(key)
    if (read.state !== 'conversation') return
    const paths = new Map<string, string>()
    for (const output of read.summary.outputs ?? []) {
      if (output.kind !== 'file') continue
      const path = outputFilePath(output.path, home)
      if (path !== null) paths.set(output.path, path)
    }
    this.bySession.set(key, paths)
  }

  private forget(key: string): void {
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    this.bySession.delete(key)
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
  /** Resolves a path's links; Node's `realpath` when left out. */
  realpath?: (path: string) => Promise<string>
}

const EXTENSIONS: ReadonlySet<string> = new Set(OUTPUT_EXTENSIONS)

/**
 * The real path to open for a listed file (D10): its links resolved, still a regular file whose
 * own extension is a document's, so a `.pdf` link to a `.command` never runs; else null.
 */
async function openablePath(
  file: string,
  deps: Pick<OutputActionDeps, 'fs' | 'realpath'>
): Promise<string | null> {
  try {
    const real = await (deps.realpath ?? realpath)(file)
    if (!EXTENSIONS.has(extname(real).slice(1).toLowerCase())) return null
    return (await isOutputFile(real, deps.fs)) ? real : null
  } catch {
    return null
  }
}

/** Opens a listed file by its real path with the OS default app (D2, D10); else `refused`, nothing run. */
export async function openListedOutput(
  sessionId: unknown,
  path: unknown,
  deps: Omit<OutputActionDeps, 'reveal'>
): Promise<OpenResult> {
  const file = deps.listed.path(sessionId, path)
  const real = file === null ? null : await openablePath(file, deps)
  if (real === null) return { ok: false, reason: 'refused' }
  const error = await deps.openPath(real)
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
