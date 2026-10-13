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
 * A card's process state. `stopped`: its shell exited, however it ended (#5 D6, which replaces
 * #4's exit code and signal); its screen is gone.
 */
export type CardRunState =
  { kind: 'running' } | { kind: 'stopped' } | { kind: 'failed'; reason: string }

/** `Running`, `Stopped` or `Couldn't start: <reason>`. */
export function statusLabel(state: CardRunState): string {
  switch (state.kind) {
    case 'running':
      return 'Running'
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return `Couldn't start: ${state.reason}`
  }
}

export interface CardStatus {
  /** See `statusLabel`. */
  label: string
  /** See `lastOutputLine`; only a running card has one. */
  lastLine: string
}

export function cardStatus(state: CardRunState, lastLine: string): CardStatus {
  return { label: statusLabel(state), lastLine: state.kind === 'running' ? lastLine : '' }
}

const NOT_STARTED: CardRunState = { kind: 'stopped' }
const NOT_STARTED_STATUS: CardStatus = cardStatus(NOT_STARTED, '')

/**
 * The card's run state, where a card the card registry doesn't know (never started in this run,
 * e.g. restored after a restart) is Stopped (#8 D9). Always the same object for such a card.
 */
export function knownRunState(state: CardRunState | undefined): CardRunState {
  return state ?? NOT_STARTED
}

/** The card's status; `Stopped` for a card the registry doesn't know (#8 D9). */
export function knownStatus(status: CardStatus | undefined): CardStatus {
  return status ?? NOT_STARTED_STATUS
}
