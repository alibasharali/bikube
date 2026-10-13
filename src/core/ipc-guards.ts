/** Runtime checks for IPC arguments: the renderer is not trusted, types alone do not hold at runtime. */

import { isDirectory, isPathArg, type StatFs } from './directories'

export const MAX_DIMENSION = 1000
export const MAX_WRITE_BYTES = 1024 * 1024

const isDimension = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION

export function isValidSize(cols: unknown, rows: unknown): boolean {
  return isDimension(cols) && isDimension(rows)
}

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0
}

/** Longest card id a spawn request may carry (#9 D3). */
export const MAX_CARD_ID_LENGTH = 100

/** A card id as the renderer sends it with a spawn request: a non-empty string of at most 100 chars. */
export function isCardId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_CARD_ID_LENGTH
}

export function isWriteData(data: unknown): data is string {
  // Every UTF-16 code unit is at most 3 UTF-8 bytes, so length bounds the cost of measuring.
  return (
    typeof data === 'string' &&
    data.length <= MAX_WRITE_BYTES &&
    Buffer.byteLength(data, 'utf8') <= MAX_WRITE_BYTES
  )
}

/** The parts of an Electron frame that tell one frame from another. */
export interface FrameIdentity {
  readonly processId: number
  readonly routingId: number
  readonly detached: boolean
}

/**
 * Whether `frame` (an IPC sender's frame) is still the window's live main frame. A request from
 * a page that has been replaced must not act for the page that replaced it (#4 D16).
 */
export function isCurrentMainFrame(
  frame: FrameIdentity | null | undefined,
  mainFrame: FrameIdentity
): boolean {
  return (
    frame != null &&
    !frame.detached &&
    frame.processId === mainFrame.processId &&
    frame.routingId === mainFrame.routingId
  )
}

/** Clipboard text shares the write cap: it ends up in a PTY when pasted. */
export const isClipboardText = isWriteData

/** Why main refused `terminal:spawn`; the renderer shows it after "Couldn't start: " (#4 D3). */
export const SPAWN_REFUSAL = {
  invalidSize: 'invalid terminal size',
  invalidDirectory: 'invalid working directory',
  directoryNotFound: 'working directory not found',
  invalidCard: 'invalid card id'
} as const

/** Null when `cwd` is an absolute path to an existing directory, else the refusal reason. */
export async function workingDirectoryProblem(
  cwd: unknown,
  fsImpl?: StatFs
): Promise<string | null> {
  if (!isPathArg(cwd)) return SPAWN_REFUSAL.invalidDirectory
  return (await isDirectory(cwd, fsImpl)) ? null : SPAWN_REFUSAL.directoryNotFound
}
