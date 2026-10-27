/**
 * The Agent setup page's Stats (#68 D14): main reads the Claude Code transcripts of the workspace
 * folder and its worktree folders, `~/.claude/projects/<encoded folder>/*.jsonl` and each session's
 * subagent transcripts, with #50's counts and its deduplication of streamed entries, over the last
 * 30 days ending today (local dates). No cost.
 */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { MAX_MODEL_LENGTH, isObject, parseLine, subagentFiles, usageEntry } from './claude-usage'
import { isDirectory, isPathArg } from './directories'
import {
  MAX_STATS_FOLDERS,
  statsWindow,
  type ClaudeStats,
  type StatsCount,
  type StatsDay
} from './claude-stats-types'

export { statsWindow } from './claude-stats-types'

/** A Claude Code project folder's name: the absolute path, every character outside A–Z a–z 0–9 a `-`. */
export const encodeProjectFolder = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, '-')

/**
 * The folders a Stats request (D28) counts: the workspace folder (an absolute, existing directory)
 * then the extra folders (each absolute, at most 100), each resolved and once. An extra folder that
 * no longer exists (a worktree removed outside Bikube) is left out; anything else malformed refuses
 * the whole request (null).
 */
export async function statsFolders(
  folder: unknown,
  extra: unknown,
  isDir: (path: unknown) => Promise<boolean> = isDirectory
): Promise<string[] | null> {
  if (!Array.isArray(extra) || extra.length > MAX_STATS_FOLDERS) return null
  if (!isPathArg(folder) || !extra.every(isPathArg)) return null
  const folders = [resolve(folder)]
  if (!(await isDir(folders[0]))) return null
  for (const path of extra as string[]) {
    const resolved = resolve(path)
    if (!folders.includes(resolved) && (await isDir(resolved))) folders.push(resolved)
  }
  return folders
}

/** The machine's local date (`YYYY-MM-DD`) of `ms`: main's `localDate`. */
export function localDateOf(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** How many entries each Most used list shows. */
const TOP = 10

/**
 * A transcript last written before this long ago holds no entry of the period (30 days, with a
 * day either side for zones), so it isn't opened.
 */
const STALE_MS = 32 * 24 * 60 * 60 * 1000

export interface StatsOptions {
  /** The user's home, whose `.claude/projects` holds the transcripts. */
  home: string
  /** The folders counted, workspace folder first; a repeated one counts once. */
  folders: readonly string[]
  now: number
  /** The local date (`YYYY-MM-DD`) of a time in ms; injected so tests use fixed dates. */
  localDate: (ms: number) => string
  /**
   * Gives main's event loop a turn (`setImmediate` by default), awaited every `LINES_PER_TURN`
   * lines and after each file, so many large transcripts never hold up PTY output and acks.
   */
  yieldToLoop?: () => Promise<void>
}

/** How many transcript lines are parsed between two turns of the event loop. */
const LINES_PER_TURN = 200

const nextTurn = (): Promise<void> => new Promise((done) => setImmediate(done))

/** Calls `onLine` with each line of `path`, awaiting `pause` after each so it can yield. */
async function eachLinePaced(
  path: string,
  onLine: (line: string) => void,
  pause: () => Promise<void>
): Promise<void> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let failure: unknown
  stream.on('error', (error) => {
    failure = error
    lines.close()
  })
  for await (const line of lines) {
    onLine(line)
    await pause()
  }
  if (failure !== undefined) throw failure
}

/**
 * Whether a top-level transcript is an older Claude Code's subagent transcript, not a session:
 * named `agent-…`, or its first entry marked `isSidechain`.
 */
const isSidechainFile = (path: string, first: unknown): boolean =>
  basename(path).startsWith('agent-') || (isObject(first) && first.isSidechain === true)

interface Counted {
  date: string
  tokens: number
  model: string
}

interface ToolUse {
  date: string
  name: string
  input: unknown
}

/** An entry's local date, or null without a valid `timestamp` (such an entry is skipped). */
function entryDate(value: unknown, localDate: (ms: number) => string): string | null {
  if (!isObject(value) || typeof value.timestamp !== 'string') return null
  const ms = Date.parse(value.timestamp)
  return Number.isFinite(ms) ? localDate(ms) : null
}

/** The `tool_use` blocks of an assistant entry's message. */
function toolUses(value: Record<string, unknown>): Record<string, unknown>[] {
  if (value.type !== 'assistant' || !isObject(value.message)) return []
  const content = value.message.content
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is Record<string, unknown> =>
      isObject(block) && block.type === 'tool_use' && typeof block.name === 'string'
  )
}

/** The `*.jsonl` files directly in `dir`, by name; none when it can't be read. */
async function transcriptFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort()
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/** Top `TOP` of `counts`, most first, then by name. */
function top(counts: Map<string, number>): StatsCount[] {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, TOP)
}

const bump = (counts: Map<string, number>, name: string): void => {
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

/**
 * Stats for `folders` (D14). Each main transcript is a session, counted on the day of its first
 * timestamped entry; tokens, models and tool uses are counted on their entry's own day. A
 * streamed message's copies (same message and request id) count once, the last copy read, and a
 * tool use once by its id. Entries without a valid timestamp and files that can't be read are
 * skipped.
 */
export async function readClaudeStats(options: StatsOptions): Promise<ClaudeStats> {
  const { home, now, localDate } = options
  const yieldToLoop = options.yieldToLoop ?? nextTurn
  let lines = 0
  const pause = async (): Promise<void> => {
    if (++lines % LINES_PER_TURN === 0) await yieldToLoop()
  }
  const folders = [...new Set(options.folders)]
  const days = statsWindow(localDate(now))
  const inWindow = new Set(days)

  const keyed = new Map<string, Counted>()
  const unkeyed: Counted[] = []
  const toolsById = new Map<string, ToolUse>()
  const toolsUnkeyed: ToolUse[] = []
  const sessionDays: string[] = []

  interface First {
    /** The first entry's local date with a valid timestamp. */
    date: string | null
    /** Whether an entry was read, and the first one. */
    read: boolean
    entry: unknown
  }

  const readLine = (line: string, first: First | null): void => {
    const value = parseLine(line)
    if (first && !first.read && isObject(value)) {
      first.read = true
      first.entry = value
    }
    const date = entryDate(value, localDate)
    if (date === null || !isObject(value)) return
    if (first && first.date === null) first.date = date
    const read = usageEntry(value)
    if (read) {
      const { counts, model } = read.entry
      const counted: Counted = {
        date,
        tokens: counts.input + counts.output + counts.cacheWrite + counts.cacheRead,
        model: model ?? 'Unknown model'
      }
      if (read.key === null) unkeyed.push(counted)
      else keyed.set(read.key, counted)
    }
    for (const block of toolUses(value)) {
      const use: ToolUse = { date, name: block.name as string, input: block.input }
      if (typeof block.id === 'string') toolsById.set(block.id, use)
      else toolsUnkeyed.push(use)
    }
  }

  const projectDirs = [
    ...new Set(folders.map((f) => join(home, '.claude', 'projects', encodeProjectFolder(f))))
  ]
  for (const dir of projectDirs) {
    for (const file of await transcriptFiles(dir)) {
      try {
        if ((await stat(file)).mtimeMs < now - STALE_MS) continue
        const first: First = { date: null, read: false, entry: undefined }
        try {
          await eachLinePaced(file, (line) => readLine(line, first), pause)
        } finally {
          await yieldToLoop()
        }
        for (const sub of await subagentFiles(file)) {
          try {
            await eachLinePaced(sub, (line) => readLine(line, null), pause)
          } finally {
            await yieldToLoop()
          }
        }
        // An older Claude Code's subagent transcript counts its entries, but isn't a session.
        if (first.date !== null && !isSidechainFile(file, first.entry)) {
          sessionDays.push(first.date)
        }
      } catch {
        // An unreadable transcript is skipped; what it gave before failing stays counted.
      }
    }
  }

  const byDay = new Map<string, StatsDay>(
    days.map((date) => [date, { date, tokens: 0, sessions: 0 }])
  )
  const models = new Map<string, number>()
  for (const entry of [...keyed.values(), ...unkeyed]) {
    const day = byDay.get(entry.date)
    if (!day) continue
    day.tokens += entry.tokens
    models.set(entry.model, (models.get(entry.model) ?? 0) + entry.tokens)
  }
  for (const date of sessionDays) {
    const day = byDay.get(date)
    if (day) day.sessions++
  }

  const tools = new Map<string, number>()
  const skills = new Map<string, number>()
  const subagents = new Map<string, number>()
  const cut = (name: string): string => name.slice(0, MAX_MODEL_LENGTH)
  for (const use of [...toolsById.values(), ...toolsUnkeyed]) {
    if (!inWindow.has(use.date)) continue
    bump(tools, cut(use.name))
    const input = isObject(use.input) ? use.input : {}
    if (use.name === 'Skill' && typeof input.skill === 'string') bump(skills, cut(input.skill))
    if ((use.name === 'Task' || use.name === 'Agent') && typeof input.subagent_type === 'string') {
      bump(subagents, cut(input.subagent_type))
    }
  }

  const dayList = days.map((date) => byDay.get(date)!)
  return {
    folders,
    days: dayList,
    sessions: dayList.reduce((sum, d) => sum + d.sessions, 0),
    tokens: dayList.reduce((sum, d) => sum + d.tokens, 0),
    models: [...models]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens || (a.model < b.model ? -1 : 1)),
    tools: top(tools),
    skills: top(skills),
    subagents: top(subagents)
  }
}
