/**
 * Reading a Claude Code session transcript (#50 D2, D3): the local `board` CLI streams the JSONL
 * file a hook names, line by line, plus its session's subagent transcripts, and sums the tokens
 * and estimated cost (D4, `claude-pricing.ts`). Never run by main or the renderer.
 */
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { entryCost, type ClaudeUsage, type TokenCounts } from './claude-pricing'

export type { ClaudeUsage } from './claude-pricing'

/** A counted transcript entry (D2). */
interface Entry {
  counts: TokenCounts
  model: string | null
  sidechain: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A count that isn't a number is 0 (D2). */
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/**
 * One line as an entry with its streaming key (D2), or null when it isn't an assistant entry with
 * a usage object or its four counts are all 0. The key is null for an entry lacking both ids.
 */
function readEntry(line: string): { key: string | null; entry: Entry } | null {
  const value = parse(line)
  if (!isObject(value) || value.type !== 'assistant') return null
  const message = value.message
  if (!isObject(message) || !isObject(message.usage)) return null
  const usage = message.usage
  const counts: TokenCounts = {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    cacheRead: count(usage.cache_read_input_tokens)
  }
  if (counts.input + counts.output + counts.cacheWrite + counts.cacheRead === 0) return null
  const id = typeof message.id === 'string' ? message.id : null
  const requestId = typeof value.requestId === 'string' ? value.requestId : null
  return {
    key: id === null && requestId === null ? null : `${id ?? ''}\n${requestId ?? ''}`,
    entry: {
      counts,
      model: typeof message.model === 'string' ? message.model : null,
      sidechain: value.isSidechain === true
    }
  }
}

/** Calls `onLine` for every line of the file, streamed; rejects when it can't be read. */
async function eachLine(path: string, onLine: (line: string) => void): Promise<void> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let failure: unknown
  stream.on('error', (error) => {
    failure = error
    lines.close()
  })
  for await (const line of lines) onLine(line)
  if (failure !== undefined) throw failure
}

/** The `*.jsonl` files of `<transcript folder>/<session id>/subagents/`; none when it's missing. */
async function subagentFiles(transcriptPath: string): Promise<string[]> {
  const folder = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents')
  let names: string[]
  try {
    names = await readdir(folder)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw error
  }
  return names
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => join(folder, name))
}

/**
 * A conversation's usage (D3) from its transcript and its subagents' (D2): rejects when any of
 * them can't be read. Context and model come from the transcript itself only; the cost is absent
 * when a counted entry's model has no price (D4).
 */
export async function readClaudeUsage(transcriptPath: string): Promise<ClaudeUsage> {
  const keyed = new Map<string, Entry>()
  const unkeyed: Entry[] = []
  let latest: Entry | null = null
  const add = (line: string, main: boolean): void => {
    const read = readEntry(line)
    if (!read) return
    if (read.key === null) unkeyed.push(read.entry)
    else keyed.set(read.key, read.entry)
    if (main && !read.entry.sidechain) latest = read.entry
  }
  await eachLine(transcriptPath, (line) => add(line, true))
  for (const file of await subagentFiles(transcriptPath)) {
    await eachLine(file, (line) => add(line, false))
  }

  const usage: ClaudeUsage = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    tokens: 0,
    context: 0,
    model: null
  }
  let cost: number | null = 0
  for (const { counts, model } of [...keyed.values(), ...unkeyed]) {
    usage.input += counts.input
    usage.output += counts.output
    usage.cacheWrite += counts.cacheWrite
    usage.cacheRead += counts.cacheRead
    const price = entryCost(model, counts)
    cost = cost === null || price === null ? null : cost + price
  }
  usage.tokens = usage.input + usage.output + usage.cacheWrite + usage.cacheRead
  const last = latest as Entry | null
  if (last) {
    usage.context = last.counts.input + last.counts.cacheWrite + last.counts.cacheRead
    usage.model = last.model
  }
  if (cost !== null) usage.cost = cost
  return usage
}
