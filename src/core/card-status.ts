/**
 * Card status rules (#4 D9). Plain TS: the renderer feeds it the terminal's screen lines and
 * cursor row, and the process state it tracks per card.
 */

// OSC (ESC ] ... BEL or ST), CSI (ESC [ params final), two-char charset/other ESC sequences,
// then any remaining C0/DEL control characters.
const ESCAPES =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]|[\x00-\x08\x0b-\x1f\x7f]/g

/** `text` with terminal escape sequences and control characters removed. */
export function stripEscapes(text: string): string {
  return text.replace(ESCAPES, '')
}

/**
 * The last non-blank line of the screen at or above the cursor row, with escape sequences
 * removed and whitespace trimmed; empty when there is none. `cursorRow` indexes `lines`.
 */
export function lastOutputLine(lines: readonly string[], cursorRow: number): string {
  for (let row = Math.min(cursorRow, lines.length - 1); row >= 0; row--) {
    const text = stripEscapes(lines[row]).trim()
    if (text) return text
  }
  return ''
}

/**
 * A card's process state. `exited` mirrors node-pty's onExit payload: a `signal` of 0 or
 * undefined means the process exited on its own with `exitCode`.
 */
export type CardRunState =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number; signal?: number }
  | { kind: 'failed'; reason: string }

/** `Running`, `Exited (code N)`, `Exited (signal N)` or `Couldn't start: <reason>`. */
export function statusLabel(state: CardRunState): string {
  switch (state.kind) {
    case 'running':
      return 'Running'
    case 'exited':
      return state.signal ? `Exited (signal ${state.signal})` : `Exited (code ${state.exitCode})`
    case 'failed':
      return `Couldn't start: ${state.reason}`
  }
}

export interface CardStatus {
  /** See `statusLabel`. */
  label: string
  /** See `lastOutputLine`; always empty for a card that couldn't start. */
  lastLine: string
}

export function cardStatus(state: CardRunState, lastLine: string): CardStatus {
  return { label: statusLabel(state), lastLine: state.kind === 'failed' ? '' : lastLine }
}
