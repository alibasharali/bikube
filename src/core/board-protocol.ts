/**
 * The `board` socket protocol (#9 D6): one JSON request line from the CLI, one JSON reply line
 * from main, then the connection closes. Plain TS, importable by main, the CLI and the renderer.
 */

import { isActivityValue } from './activity'
import { isBoardAgent, isListFormat, isSessionId, isSetupResult } from './board-args'
import type { BoardCommand } from './board-args'
import type { ClaudeUsage } from './claude-usage-types'

export const BOARD_PROTOCOL_VERSION = 1
/**
 * Longest request line main reads, in UTF-8 bytes without the newline (#9 D6): room for a
 * `describe` carrying a whole description (#69 D5).
 */
export const MAX_REQUEST_LINE_BYTES = 512 * 1024

export const INVALID_REQUEST = 'board: invalid request'
export const REQUEST_TOO_LONG = 'board: request too long'
/** The board did not answer: timed out, failed, or its page reloaded or crashed (#9 D9). */
export const NO_ANSWER = 'board: no answer from Bikube'
/** How long `board` waits for main's reply (#9 D9), locally and in SSH cards (#25 D5). */
export const ANSWER_TIMEOUT_MS = 5000

/** A request as sent: the calling card's id plus one command. */
export type BoardRequest = { v: typeof BOARD_PROTOCOL_VERSION; cardId: string } & BoardCommand

/** `output`, when present, is what the CLI prints to stdout (`board list`, `board create`). */
export type BoardReply = { ok: true; output?: string } | { ok: false; error: string }

/** Longest error a reply may carry, in characters. */
export const MAX_REPLY_ERROR_LENGTH = 8192

/** Longest output a reply may carry, in characters. */
export const MAX_REPLY_OUTPUT_LENGTH = 1_000_000

export type ParsedRequest = { ok: true; request: BoardRequest } | { ok: false; error: string }

/** The request line the CLI writes, newline included. */
export function serializeRequest(cardId: string, command: BoardCommand): string {
  return `${JSON.stringify({ v: BOARD_PROTOCOL_VERSION, cardId, ...command })}\n`
}

/** Whether `line` is over `MAX_REQUEST_LINE_BYTES` in UTF-8. */
export function isOverLineLimit(line: string): boolean {
  // Every UTF-16 code unit is 1 to 3 UTF-8 bytes, so length decides most lines unencoded.
  if (line.length > MAX_REQUEST_LINE_BYTES) return true
  if (line.length * 3 <= MAX_REQUEST_LINE_BYTES) return false
  return new TextEncoder().encode(line).length > MAX_REQUEST_LINE_BYTES
}

/** Each command's required fields besides `v`, `cardId` and `command`. */
const FIELDS: Record<BoardCommand['command'], readonly string[]> = {
  workspaces: ['format'],
  list: ['format'],
  create: ['column', 'title'],
  rename: ['card', 'title'],
  move: ['card', 'column'],
  status: ['card', 'text'],
  activity: ['card', 'activity'],
  session: ['card', 'session'],
  setup: ['card', 'result'],
  usage: ['card', 'usage'],
  description: ['card'],
  describe: ['card', 'description']
}

/** The commands that take a `workspace` (#69 D6). */
const TAKES_WORKSPACE = new Set([
  'list',
  'create',
  'rename',
  'move',
  'status',
  'description',
  'describe'
])

/** Each command's optional string fields (#69 D6, D8). */
function optionalFields(command: BoardCommand['command']): readonly string[] {
  if (command === 'create') return ['workspace', 'agent', 'description']
  return TAKES_WORKSPACE.has(command) ? ['workspace'] : []
}

const COMMANDS = new Set(Object.keys(FIELDS))

/** Longest model name a usage may carry (#50 D5). */
export const MAX_USAGE_MODEL_LENGTH = 200

const USAGE_COUNTS = ['input', 'output', 'cacheWrite', 'cacheRead', 'tokens', 'context'] as const

/**
 * A usage as `board usage` sends it (#50 D5): exactly the six counts as non-negative safe
 * integers and the model as a string of at most 200 characters or null. Null for anything else.
 */
export function asUsage(value: unknown): ClaudeUsage | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== USAGE_COUNTS.length + 1) return null
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
  if (!USAGE_COUNTS.every((key) => count(value[key]))) return null
  const { model } = value
  if (!('model' in value)) return null
  if (model !== null && (typeof model !== 'string' || model.length > MAX_USAGE_MODEL_LENGTH)) {
    return null
  }
  return {
    input: value.input as number,
    output: value.output as number,
    cacheWrite: value.cacheWrite as number,
    cacheRead: value.cacheRead as number,
    tokens: value.tokens as number,
    context: value.context as number,
    model
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The request in one received line (a trailing newline is ignored), or the error reason to
 * reply with: anything but exactly a version-1 workspaces or list (format `text` or `json`, #69
 * D6), create, rename, move, status, activity (#31 D12), session, setup (#39 D4), usage (#50 D5),
 * description or describe (#69 D5) with string fields, a `workspace` only on the commands D6
 * names, create's `agent` one `board` takes (#69 D8), an activity's or a setup's value being one
 * `board` takes and a usage shaped as `asUsage` checks, is refused.
 */
export function parseRequestLine(line: string): ParsedRequest {
  const text = line.endsWith('\n') ? line.slice(0, -1) : line
  if (isOverLineLimit(text)) return { ok: false, error: REQUEST_TOO_LONG }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: INVALID_REQUEST }
  }
  if (!isRecord(value) || value.v !== BOARD_PROTOCOL_VERSION) {
    return { ok: false, error: INVALID_REQUEST }
  }
  const command = value.command
  if (typeof command !== 'string' || !COMMANDS.has(command)) {
    return { ok: false, error: INVALID_REQUEST }
  }
  const name = command as BoardCommand['command']
  const required = FIELDS[name]
  const optional = optionalFields(name)
  const keys = Object.keys(value)
  const known = (key: string): boolean =>
    key === 'v' ||
    key === 'cardId' ||
    key === 'command' ||
    required.includes(key) ||
    optional.includes(key)
  const shaped =
    typeof value.cardId === 'string' &&
    keys.every(known) &&
    required.every((f) => f in value && (f === 'usage' || typeof value[f] === 'string')) &&
    optional.every((f) => value[f] === undefined || typeof value[f] === 'string')
  if (!shaped) return { ok: false, error: INVALID_REQUEST }
  const request = asRequest(name, value as Record<string, unknown>)
  return request ? { ok: true, request } : { ok: false, error: INVALID_REQUEST }
}

/** The request in a shaped value, its fields checked per command; null when one is wrong. */
function asRequest(
  command: BoardCommand['command'],
  value: Record<string, unknown>
): BoardRequest | null {
  const str = (key: string): string => value[key] as string
  const cardId = str('cardId')
  const card = str('card')
  const where = value.workspace !== undefined ? { workspace: str('workspace') } : {}
  switch (command) {
    case 'workspaces':
      return isListFormat(value.format) ? { v: 1, cardId, command, format: value.format } : null
    case 'list':
      return isListFormat(value.format)
        ? { v: 1, cardId, command, format: value.format, ...where }
        : null
    case 'create': {
      const { agent } = value
      if (agent !== undefined && !isBoardAgent(agent)) return null
      return {
        v: 1,
        cardId,
        command,
        column: str('column'),
        title: str('title'),
        ...where,
        ...(agent !== undefined && { agent }),
        ...(value.description !== undefined && { description: str('description') })
      }
    }
    case 'rename':
      return { v: 1, cardId, command, card, title: str('title'), ...where }
    case 'move':
      return { v: 1, cardId, command, card, column: str('column'), ...where }
    case 'status':
      return { v: 1, cardId, command, card, text: str('text'), ...where }
    case 'description':
      return { v: 1, cardId, command, card, ...where }
    case 'describe':
      return { v: 1, cardId, command, card, description: str('description'), ...where }
    case 'session':
      return isSessionId(value.session)
        ? { v: 1, cardId, command, card, session: value.session }
        : null
    case 'usage': {
      const usage = asUsage(value.usage)
      return usage ? { v: 1, cardId, command, card, usage } : null
    }
    case 'setup':
      return isSetupResult(value.result)
        ? { v: 1, cardId, command, card, result: value.result }
        : null
    case 'activity':
      return isActivityValue(value.activity)
        ? { v: 1, cardId, command, card, activity: value.activity }
        : null
  }
}

/** The reply line main writes, newline included. */
export function serializeReply(reply: BoardReply): string {
  if (!reply.ok) return `${JSON.stringify({ ok: false, error: reply.error })}\n`
  return `${JSON.stringify(reply.output === undefined ? { ok: true } : { ok: true, output: reply.output })}\n`
}

/** The reply in one received line, or null when it is not a reply. */
export function parseReplyLine(line: string): BoardReply | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value.ok === true) {
    if (value.output === undefined) return { ok: true }
    return typeof value.output === 'string' ? { ok: true, output: value.output } : null
  }
  if (value.ok === false && typeof value.error === 'string')
    return { ok: false, error: value.error }
  return null
}
