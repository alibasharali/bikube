/**
 * Argument parsing for the `board` command (#9 D1). Plain TS: the CLI entry passes the
 * arguments after `board` and prints or sends what comes back.
 */

import { isActivityValue, type ActivityValue } from './activity'

export const BOARD_USAGE = `usage: board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none
       board session <card> <session-id>

  <card>    . for this card, or a card's id or title in this workspace
  <column>  a column title of this workspace (any case)
  <text>    the card's status text; "" clears it
  activity  working, waiting for you, or a question for you; none clears it
  session   the Claude Code session the card resumes (Drovr's Claude hooks set it)
`

export type BoardCommand =
  | { command: 'move'; card: string; column: string }
  | { command: 'status'; card: string; text: string }
  | { command: 'activity'; card: string; activity: ActivityValue }
  | { command: 'session'; card: string; session: string }

export type BoardArgs =
  | { kind: 'help'; stdout: string; exitCode: 0 }
  | { kind: 'usage'; stderr: string; exitCode: 2 }
  | { kind: 'command'; command: BoardCommand }

/** What `board <argv...>` asks for: usage (help or a wrong shape) or one command. */
export function parseBoardArgs(argv: readonly string[]): BoardArgs {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === 'help' || argv[0] === '--help'))) {
    return { kind: 'help', stdout: BOARD_USAGE, exitCode: 0 }
  }
  if (argv.length === 3) {
    const [name, card, value] = argv
    if (name === 'move')
      return { kind: 'command', command: { command: 'move', card, column: value } }
    if (name === 'status')
      return { kind: 'command', command: { command: 'status', card, text: value } }
    if (name === 'activity' && isActivityValue(value))
      return { kind: 'command', command: { command: 'activity', card, activity: value } }
    if (name === 'session' && isSessionId(value))
      return { kind: 'command', command: { command: 'session', card, session: value } }
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
