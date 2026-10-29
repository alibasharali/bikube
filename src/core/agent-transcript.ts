/**
 * Main's side of the Agent tab (#75 D3, D4, D5): the request's checks, and the session's
 * transcript under `<home>/.claude/projects` tailed into its agent summary (`agent-summary.ts`).
 * fs is injected for Vitest; nothing outside that path is read.
 */
import { open, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  addTranscriptLine,
  agentSummary,
  newTranscriptState,
  type TranscriptState
} from './agent-summary'
import { isSessionId, type AgentSummaryRead } from './agent-tab'
import { encodeProjectFolder } from './claude-stats'
import { isDirectory, isPathArg } from './directories'

export interface TranscriptFs {
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>
}

/** The session's transcript for a card in `folder` (D3). */
export const transcriptPath = (home: string, folder: string, sessionId: string): string =>
  join(home, '.claude', 'projects', encodeProjectFolder(folder), `${sessionId}.jsonl`)

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

export interface TailFs {
  stat(path: string): Promise<{ isFile(): boolean; size: number; ino: number }>
  open(path: string): Promise<{
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number }>
    close(): Promise<void>
  }>
}

const nodeTailFs: TailFs = { stat, open: (path) => open(path, 'r') }

/** How many lines are parsed between two turns of main's event loop (as `claude-stats.ts`). */
const LINES_PER_TURN = 200
/** How long a transcript's tail state is kept after its last request (D5). */
export const TAIL_DROP_MS = 60_000
/** How many bytes are read at a time. */
const CHUNK = 1 << 20

const nextTurn = (): Promise<void> => new Promise((done) => setImmediate(done))

/** A transcript's tail: the bytes read, the line begun after them, and the parse state. */
interface Tail {
  ino: number
  offset: number
  partial: Buffer
  state: TranscriptState
  version: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Tails transcripts for the Agent tab (D4, D5): per path the byte offset read and the parse state,
 * so a request parses only the bytes appended since; a file that shrank or was replaced is read
 * from the start; a path's state is dropped 60 s after its last request. Requests for one path run
 * one at a time. Versions are unique across paths and drops, so a stale one never reads unchanged.
 */
export class TranscriptTailer {
  private readonly fs: TailFs
  private readonly yieldToLoop: () => Promise<void>
  private readonly tails = new Map<string, Tail>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private versions = 0

  constructor(deps: { fs?: TailFs; yieldToLoop?: () => Promise<void> } = {}) {
    this.fs = deps.fs ?? nodeTailFs
    this.yieldToLoop = deps.yieldToLoop ?? nextTurn
  }

  /** The summary of `path`, or `unchanged` when `since` is the version it would carry. */
  read(path: string, since?: number): Promise<AgentSummaryRead> {
    const previous = this.queues.get(path) ?? Promise.resolve()
    const run = previous.then(() => this.readNow(path, since))
    const queued = run.catch(() => undefined)
    this.queues.set(path, queued)
    void queued.then(() => {
      if (this.queues.get(path) === queued) this.queues.delete(path)
    })
    return run
  }

  private drop(path: string): void {
    const tail = this.tails.get(path)
    if (tail?.timer !== undefined) clearTimeout(tail.timer)
    this.tails.delete(path)
  }

  private async readNow(path: string, since?: number): Promise<AgentSummaryRead> {
    let info: { isFile(): boolean; size: number; ino: number }
    try {
      info = await this.fs.stat(path)
    } catch (error) {
      this.drop(path)
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'none' }
      return { state: 'error', reason: code ?? 'unreadable' }
    }
    if (!info.isFile()) {
      this.drop(path)
      return { state: 'none' }
    }
    let tail = this.tails.get(path)
    if (tail && (tail.ino !== info.ino || info.size < tail.offset)) {
      this.drop(path)
      tail = undefined
    }
    if (!tail) {
      tail = {
        ino: info.ino,
        offset: 0,
        partial: Buffer.alloc(0),
        state: newTranscriptState(),
        version: ++this.versions,
        timer: undefined
      }
      this.tails.set(path, tail)
    }
    if (tail.timer !== undefined) clearTimeout(tail.timer)
    tail.timer = setTimeout(() => this.drop(path), TAIL_DROP_MS)
    tail.timer.unref?.()

    if (info.size > tail.offset) {
      try {
        if (await this.readAppended(path, tail, info.size)) tail.version = ++this.versions
      } catch (error) {
        // Half a read leaves the state unsure: the next request starts again.
        this.drop(path)
        return { state: 'error', reason: errorCode(error) ?? 'unreadable' }
      }
    }
    if (since === tail.version) return { state: 'unchanged' }
    return { state: 'conversation', version: tail.version, summary: agentSummary(tail.state) }
  }

  /** Parses the bytes from the tail's offset to `size`; whether any whole line was read. */
  private async readAppended(path: string, tail: Tail, size: number): Promise<boolean> {
    const handle = await this.fs.open(path)
    let lines = 0
    try {
      let position = tail.offset
      let partial = tail.partial
      while (position < size) {
        const buffer = Buffer.alloc(Math.min(CHUNK, size - position))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) break
        position += bytesRead
        const bytes = Buffer.concat([partial, buffer.subarray(0, bytesRead)])
        const end = bytes.lastIndexOf(0x0a)
        if (end === -1) {
          partial = bytes
          continue
        }
        partial = bytes.subarray(end + 1)
        for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
          addTranscriptLine(tail.state, line, null)
          if (++lines % LINES_PER_TURN === 0) await this.yieldToLoop()
        }
      }
      tail.offset = position
      tail.partial = Buffer.from(partial)
    } finally {
      await handle.close()
    }
    return lines > 0
  }
}

/**
 * Answers the tab's request: a session id that isn't a UUID or a folder that isn't an absolute
 * existing directory is refused before anything is read; else the transcript's summary from
 * `tailer`, `unchanged` when `since` is the version the asker holds.
 */
export async function readAgentSummary(
  request: { folder: unknown; sessionId: unknown; since?: unknown },
  deps: { home: string; fs?: TranscriptFs; tailer?: TranscriptTailer }
): Promise<AgentSummaryRead> {
  const fs = deps.fs ?? { stat }
  if (!isSessionId(request.sessionId)) return { state: 'error', reason: 'invalid session id' }
  if (!isPathArg(request.folder) || !(await isDirectory(request.folder, fs))) {
    return { state: 'error', reason: 'not a folder' }
  }
  const path = transcriptPath(deps.home, resolve(request.folder), request.sessionId)
  const since = Number.isSafeInteger(request.since) ? (request.since as number) : undefined
  return (deps.tailer ?? new TranscriptTailer()).read(path, since)
}

export interface LookupFs {
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>
}

/**
 * A shell's transcript (D3a): Claude Code may have run in any folder the user `cd`'d to, so the
 * session's file is looked for one level under `<home>/.claude/projects`, the most recently
 * written when several match; null when none does. `sessionId` must already be checked.
 */
export async function findSessionTranscript(
  home: string,
  sessionId: string,
  fs: LookupFs = { readdir, stat }
): Promise<string | null> {
  const projects = join(home, '.claude', 'projects')
  let folders: string[]
  try {
    folders = await fs.readdir(projects)
  } catch {
    return null
  }
  let found: { path: string; mtimeMs: number } | null = null
  for (const name of folders) {
    const path = join(projects, name, `${sessionId}.jsonl`)
    try {
      const info = await fs.stat(path)
      if (info.isFile() && (found === null || info.mtimeMs > found.mtimeMs)) {
        found = { path, mtimeMs: info.mtimeMs }
      }
    } catch {
      // Not in this folder.
    }
  }
  return found?.path ?? null
}

/**
 * Answers a shell's request (D3a, D4), which names the session alone: a session id that isn't a
 * UUID is refused before anything is read; else the summary of the transcript
 * `findSessionTranscript` finds, `none` while there is none.
 */
export async function readSessionSummary(
  request: { sessionId: unknown; since?: unknown },
  deps: { home: string; fs?: LookupFs; tailer?: TranscriptTailer }
): Promise<AgentSummaryRead> {
  if (!isSessionId(request.sessionId)) return { state: 'error', reason: 'invalid session id' }
  const path = await findSessionTranscript(deps.home, request.sessionId.toLowerCase(), deps.fs)
  if (path === null) return { state: 'none' }
  const since = Number.isSafeInteger(request.since) ? (request.since as number) : undefined
  return (deps.tailer ?? new TranscriptTailer()).read(path, since)
}
