/**
 * `board reply` (#81 D21): main reads a local Claude Code card's transcript, where the Agent tab
 * reads it (#75 D3: `<home>/.claude/projects/<folder>/<session>.jsonl`), from its end back to the
 * main agent's last assistant message with text. Only that file is read, and nothing it names.
 */
import { open, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isSessionId, type ReplyRead } from './agent-tab'
import { transcriptPath } from './agent-transcript'
import { isDirectory, isPathArg } from './directories'

/** The most characters a reply prints; a longer one keeps its end, `…` first. */
export const MAX_REPLY_LENGTH = 100_000

export type { ReplyRead }

/** How many bytes are read at a time, from the end. */
const CHUNK = 1 << 20

/** `text` cut to `MAX_REPLY_LENGTH` characters, keeping its end with `…` first. */
export function cutReply(text: string): string {
  if (text.length <= MAX_REPLY_LENGTH) return text
  let end = text.slice(text.length - (MAX_REPLY_LENGTH - 1))
  // A pair's low surrogate alone would print as garbage.
  const first = end.charCodeAt(0)
  if (first >= 0xdc00 && first <= 0xdfff) end = end.slice(1)
  return `…${end}`
}

/** The file's lines from the last to the first, read `chunk` bytes at a time. */
async function* linesFromEnd(path: string, size: number, chunk: number): AsyncGenerator<string> {
  const handle = await open(path, 'r')
  try {
    let position = size
    // The start of a line whose beginning is in a chunk not read yet.
    let rest = Buffer.alloc(0)
    while (position > 0) {
      const length = Math.min(chunk, position)
      position -= length
      const buffer = Buffer.alloc(length)
      let read = 0
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, position + read)
        if (bytesRead === 0) break
        read += bytesRead
      }
      const data = Buffer.concat([buffer.subarray(0, read), rest])
      // A newline byte is never inside a multi-byte UTF-8 character.
      let end = data.length
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== 0x0a) continue
        if (end > i + 1) yield data.toString('utf8', i + 1, end)
        end = i
      }
      rest = data.subarray(0, end)
    }
    if (rest.length > 0) yield rest.toString('utf8')
  } finally {
    await handle.close()
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

/** A message's text blocks, trimmed, empty ones left out. */
function textBlocks(message: Record<string, unknown>): string[] {
  const { content } = message
  if (typeof content === 'string') return content.trim() ? [content.trim()] : []
  if (!Array.isArray(content)) return []
  return content
    .filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .filter((t) => t !== '')
}

/** Whether a user entry is a prompt (anything but tool results alone), which ends a message. */
function isPrompt(entry: Record<string, unknown>): boolean {
  const message = entry.message
  if (!isObject(message)) return false
  const { content } = message
  if (!Array.isArray(content)) return true
  return !content.every((b) => isObject(b) && b.type === 'tool_result')
}

/**
 * The main agent's last assistant message with text in `lines` (read from the end): its entries
 * sharing one message id (Claude Code writes a message's blocks as entries of their own), each
 * text block once, joined by blank lines; null for none. Subagent (sidechain) entries are skipped.
 */
async function lastReply(lines: AsyncIterable<string>): Promise<string | null> {
  let found = false
  let id: string | null = null
  const entries: string[][] = []
  for await (const line of lines) {
    const entry = parse(line)
    if (!entry || entry.isSidechain === true) continue
    if (entry.type === 'user') {
      if (found && isPrompt(entry)) break
      continue
    }
    if (entry.type !== 'assistant' || !isObject(entry.message)) continue
    const messageId = typeof entry.message.id === 'string' ? entry.message.id : null
    const texts = textBlocks(entry.message)
    if (!found) {
      if (texts.length === 0) continue
      found = true
      id = messageId
      entries.push(texts)
      if (messageId === null) break
      continue
    }
    if (messageId !== id) break
    entries.push(texts)
  }
  if (!found) return null
  const blocks = [...new Set(entries.reverse().flat())]
  return blocks.join('\n\n')
}

/**
 * `board reply`'s read: a session id that isn't a UUID or a folder that isn't an absolute existing
 * directory is refused before anything is read; else the transcript's last reply, cut to
 * `MAX_REPLY_LENGTH`, or none.
 */
export async function readLastReply(
  request: { folder: unknown; sessionId: unknown },
  deps: { home: string; chunk?: number }
): Promise<ReplyRead> {
  if (!isSessionId(request.sessionId)) return { state: 'error', reason: 'invalid session id' }
  if (!isPathArg(request.folder) || !(await isDirectory(request.folder))) {
    return { state: 'error', reason: 'not a folder' }
  }
  const path = transcriptPath(deps.home, resolve(request.folder), request.sessionId)
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { state: 'none' }
    size = info.size
  } catch {
    return { state: 'none' }
  }
  try {
    const text = await lastReply(linesFromEnd(path, size, deps.chunk ?? CHUNK))
    return text === null ? { state: 'none' } : { state: 'reply', text: cutReply(text) }
  } catch {
    return { state: 'none' }
  }
}
