/**
 * Argument parsing for the `board` command (#9 D1). Plain TS: the CLI entry passes the
 * arguments after `board` and prints or sends what comes back.
 */

import { isActivityValue, type ActivityValue } from './activity'
import type { ClaudeUsage } from './claude-usage-types'

/** What SSH cards' `board` takes (#25): the card commands only. */
export const SSH_BOARD_USAGE = `usage: board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none
       board session <card> <session-id>

  <card>    . for this card, or a card's id or title in this workspace
  <column>  a column title of this workspace (any case)
  <text>    the card's status text; "" clears it
  activity  working, waiting for you, or a question for you; none clears it
  session   the Claude Code session the card resumes (Bikube's Claude hooks set it)
`

export const BOARD_USAGE = `usage: board list [--json]
       board create <column> <title>
       board rename <card> <title>
       board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none
       board session <card> <session-id>

  list      this workspace's columns and cards, with each card's id and state
  create    a new card at the bottom of <column>, not started; prints its id
  <card>    . for this card, or a card's id or title in this workspace
  <column>  a column title of this workspace (any case)
  <text>    the card's status text; "" clears it
  activity  working, waiting for you, or a question for you; none clears it
  session   the Claude Code session the card resumes (Bikube's Claude hooks set it)
`

export type BoardCommand =
  | { command: 'list'; format: ListFormat }
  | { command: 'create'; column: string; title: string }
  | { command: 'rename'; card: string; title: string }
  | { command: 'move'; card: string; column: string }
  | { command: 'status'; card: string; text: string }
  | { command: 'activity'; card: string; activity: ActivityValue }
  | { command: 'session'; card: string; session: string }
  /** Typed by a worktree card's setup line (#39 D3, D4); not in the usage text. */
  | { command: 'setup'; card: string; result: SetupResult }
  /** Sent by `board usage` after reading the transcript (#50 D5); not in the usage text. */
  | { command: 'usage'; card: string; usage: ClaudeUsage }

/** How `board list` prints: lines for a person, or JSON for a program. */
export type ListFormat = 'text' | 'json'

export const isListFormat = (value: unknown): value is ListFormat =>
  value === 'text' || value === 'json'

/** What a setup line reports (#39 D4). */
export type SetupResult = 'ok' | 'failed'

export const isSetupResult = (value: unknown): value is SetupResult =>
  value === 'ok' || value === 'failed'

export type BoardArgs =
  | { kind: 'help'; stdout: string; exitCode: 0 }
  | { kind: 'usage'; stderr: string; exitCode: 2 }
  | { kind: 'command'; command: BoardCommand }
  /** `board usage <card> <transcript>` (#50 D5): the client reads the transcript, then sends. */
  | { kind: 'transcript'; card: string; path: string }

/** What `board <argv...>` asks for: usage (help or a wrong shape) or one command. */
export function parseBoardArgs(argv: readonly string[]): BoardArgs {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === 'help' || argv[0] === '--help'))) {
    return { kind: 'help', stdout: BOARD_USAGE, exitCode: 0 }
  }
  if (argv[0] === 'list' && argv.length <= 2) {
    if (argv.length === 1) return { kind: 'command', command: { command: 'list', format: 'text' } }
    if (argv[1] === '--json') {
      return { kind: 'command', command: { command: 'list', format: 'json' } }
    }
  }
  if (argv.length === 3) {
    const [name, card, value] = argv
    if (name === 'create')
      return { kind: 'command', command: { command: 'create', column: card, title: value } }
    if (name === 'rename')
      return { kind: 'command', command: { command: 'rename', card, title: value } }
    if (name === 'move')
      return { kind: 'command', command: { command: 'move', card, column: value } }
    if (name === 'status')
      return { kind: 'command', command: { command: 'status', card, text: value } }
    if (name === 'activity' && isActivityValue(value))
      return { kind: 'command', command: { command: 'activity', card, activity: value } }
    if (name === 'session' && isSessionId(value))
      return { kind: 'command', command: { command: 'session', card, session: value } }
    if (name === 'setup' && isSetupResult(value))
      return { kind: 'command', command: { command: 'setup', card, result: value } }
    if (name === 'usage') return { kind: 'transcript', card, path: value }
  }
  return { kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 }
}

/** A Claude Code session id: a UUID, any case. */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}
