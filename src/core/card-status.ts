import { ACTIVITY_LABELS, type Activity } from './activity'

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

// Unicode's Private Use Areas, where Nerd Fonts puts its icons and Powerline separators.
const PRIVATE_USE = /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/gu

/**
 * `text` without Private Use Area glyphs (prompt icons and separators such as starship's, which
 * only make sense with the terminal's colours), runs of spaces left behind collapsed.
 */
export function withoutPromptGlyphs(text: string): string {
  return text.replace(PRIVATE_USE, ' ').replace(/ {2,}/g, ' ')
}

/**
 * The last non-blank line of the screen at or above the cursor row, with escape sequences and
 * prompt glyphs removed and whitespace trimmed; empty when there is none. `cursorRow` indexes
 * `lines`.
 */
export function lastOutputLine(lines: readonly string[], cursorRow: number): string {
  for (let row = Math.min(cursorRow, lines.length - 1); row >= 0; row--) {
    const text = withoutPromptGlyphs(stripEscapes(lines[row])).trim()
    if (text) return text
  }
  return ''
}

/**
 * A card's process state. `stopped`: its shell exited, however it ended (#5 D6, which replaces
 * #4's exit code and signal); its screen is gone. `sshFailed` is set when an SSH card's shell
 * exited by itself with `ssh`'s code 255 (#12 D7), to its last output line at exit (empty when
 * none); such a card is Stopped in every other way.
 */
export type CardRunState =
  { kind: 'running' } | { kind: 'stopped'; sshFailed?: string } | { kind: 'failed'; reason: string }

/** `Running`, `Stopped`, `SSH failed: <line>` or `Couldn't start: <reason>`. */
export function statusLabel(state: CardRunState): string {
  switch (state.kind) {
    case 'running':
      return 'Running'
    case 'stopped':
      if (state.sshFailed === undefined) return 'Stopped'
      return `SSH failed: ${state.sshFailed || 'exit code 255'}`
    case 'failed':
      return `Couldn't start: ${state.reason}`
  }
}

/** What a card shows below its title (#31 D11); only a running card has text after the label. */
export interface CardStatus {
  /** See `statusLabel`. */
  label: string
  /** The cleaned text `board status` set while running (#9 D8); empty when none. */
  agentStatus: string
  /** The last output line (see `lastOutputLine`) while running; empty otherwise. */
  lastLine: string
  /** What `board activity` set while running (#31 D12, D13); absent when none. */
  activity?: Activity
  /** The setup's state in this start while running (#39 D5); absent when none. */
  setup?: SetupState
}

/**
 * A card's setup in this start (#39 D5): `running` once its setup line is typed until `board
 * setup` answers, `failed` after `board setup . failed`. Runtime only.
 */
export type SetupState = 'running' | 'failed'

/** The pill on a card's status row: its setup state, else its activity (#39 D5, #31 D13). */
export interface CardPill {
  kind: Activity | 'setup-running' | 'setup-failed'
  label: string
}

/** The status row's pill: the setup state takes precedence over any activity; null for none. */
export function cardPill(status: CardStatus): CardPill | null {
  if (status.setup === 'running') return { kind: 'setup-running', label: 'Setting up' }
  if (status.setup === 'failed') return { kind: 'setup-failed', label: 'Setup failed' }
  if (status.activity) return { kind: status.activity, label: ACTIVITY_LABELS[status.activity] }
  return null
}

/**
 * `agentStatus` is the cleaned text `board status` set; empty when none is set (#9 D8).
 * `activity` is what `board activity` set (#31 D12); `setup` the setup's state (#39 D5); null or
 * omitted when none.
 */
export function cardStatus(
  state: CardRunState,
  lastLine: string,
  agentStatus = '',
  activity: Activity | null = null,
  setup: SetupState | null = null
): CardStatus {
  const label = statusLabel(state)
  if (state.kind !== 'running') return { label, agentStatus: '', lastLine: '' }
  return {
    label,
    agentStatus,
    lastLine,
    ...(activity && { activity }),
    ...(setup && { setup })
  }
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
