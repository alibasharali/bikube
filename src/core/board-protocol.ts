/**
 * The `board` socket protocol (#9 D6): one JSON request line from the CLI, one JSON reply line
 * from main, then the connection closes. Plain TS, importable by main, the CLI and the renderer.
 */

import { isActivityValue } from './activity'
import { isSessionId, isSetupResult } from './board-args'
import type { BoardCommand } from './board-args'
import type { ClaudeUsage } from './claude-pricing'

export const BOARD_PROTOCOL_VERSION = 1
/** Longest request line main reads, in UTF-8 bytes without the newline (#9 D6). */
export const MAX_REQUEST_LINE_BYTES = 8192

export const INVALID_REQUEST = 'board: invalid request'
export const REQUEST_TOO_LONG = 'board: request too long'
/** The board did not answer: timed out, failed, or its page reloaded or crashed (#9 D9). */
export const NO_ANSWER = 'board: no answer from Drovr'
/** How long `board` waits for main's reply (#9 D9), locally and in SSH cards (#25 D5). */
export const ANSWER_TIMEOUT_MS = 5000

/** A request as sent: the calling card's id plus one command. */
export type BoardRequest = { v: typeof BOARD_PROTOCOL_VERSION; cardId: string } & BoardCommand

export type BoardReply = { ok: true } | { ok: false; error: string }

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

const FIELDS: Record<BoardCommand['command'], readonly string[]> = {
  move: ['v', 'cardId', 'command', 'card', 'column'],
  status: ['v', 'cardId', 'command', 'card', 'text'],
  activity: ['v', 'cardId', 'command', 'card', 'activity'],
  session: ['v', 'cardId', 'command', 'card', 'session'],
  setup: ['v', 'cardId', 'command', 'card', 'result'],
  usage: ['v', 'cardId', 'command', 'card', 'usage']
}

/** Longest model name a usage may carry (#50 D5). */
export const MAX_USAGE_MODEL_LENGTH = 200

const USAGE_COUNTS = ['input', 'output', 'cacheWrite', 'cacheRead', 'tokens', 'context'] as const

/**
 * A usage as `board usage` sends it (#50 D5): exactly the six counts as non-negative safe
 * integers, the model as a string of at most 200 characters or null, and the cost, when present,
 * a non-negative finite number. Null for anything else.
 */
function asUsage(value: unknown): ClaudeUsage | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  const hasCost = 'cost' in value
  if (keys.length !== USAGE_COUNTS.length + 1 + (hasCost ? 1 : 0)) return null
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
  if (!USAGE_COUNTS.every((key) => count(value[key]))) return null
  const { model, cost } = value
  if (!('model' in value)) return null
  if (model !== null && (typeof model !== 'string' || model.length > MAX_USAGE_MODEL_LENGTH)) {
    return null
  }
  if (hasCost && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) return null
  const usage: ClaudeUsage = {
    input: value.input as number,
    output: value.output as number,
    cacheWrite: value.cacheWrite as number,
    cacheRead: value.cacheRead as number,
    tokens: value.tokens as number,
    context: value.context as number,
    model
  }
  if (hasCost) usage.cost = cost as number
  return usage
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The request in one received line (a trailing newline is ignored), or the error reason to
 * reply with: anything but exactly a version-1 move, status, activity (#31 D12), session, setup
 * (#39 D4) or usage (#50 D5) with string fields, an activity's or a setup's value being one `board`
 * takes and a usage shaped as `asUsage` checks, is refused.
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
  if (
    command !== 'move' &&
    command !== 'status' &&
    command !== 'activity' &&
    command !== 'session' &&
    command !== 'setup' &&
    command !== 'usage'
  ) {
    return { ok: false, error: INVALID_REQUEST }
  }
  const fields = FIELDS[command]
  const keys = Object.keys(value)
  const shaped =
    keys.length === fields.length &&
    fields.every(
      (f) => f === 'v' || f === 'command' || f === 'usage' || typeof value[f] === 'string'
    )
  if (!shaped) return { ok: false, error: INVALID_REQUEST }
  const { cardId, card } = value as Record<string, string>
  if (command === 'move') {
    return { ok: true, request: { v: 1, cardId, command, card, column: value.column as string } }
  }
  if (command === 'status') {
    return { ok: true, request: { v: 1, cardId, command, card, text: value.text as string } }
  }
  if (command === 'session') {
    const session = value.session
    if (!isSessionId(session)) return { ok: false, error: INVALID_REQUEST }
    return { ok: true, request: { v: 1, cardId, command, card, session } }
  }
  if (command === 'usage') {
    const usage = asUsage(value.usage)
    if (!usage) return { ok: false, error: INVALID_REQUEST }
    return { ok: true, request: { v: 1, cardId, command, card, usage } }
  }
  if (command === 'setup') {
    const result = value.result
    if (!isSetupResult(result)) return { ok: false, error: INVALID_REQUEST }
    return { ok: true, request: { v: 1, cardId, command, card, result } }
  }
  const activity = value.activity
  if (!isActivityValue(activity)) return { ok: false, error: INVALID_REQUEST }
  return { ok: true, request: { v: 1, cardId, command, card, activity } }
}

/** The reply line main writes, newline included. */
export function serializeReply(reply: BoardReply): string {
  return `${JSON.stringify(reply.ok ? { ok: true } : { ok: false, error: reply.error })}\n`
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
  if (value.ok === true) return { ok: true }
  if (value.ok === false && typeof value.error === 'string')
    return { ok: false, error: value.error }
  return null
}
