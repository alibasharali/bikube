/**
 * Argument parsing for the `board` command (#9 D1). Plain TS: the CLI entry passes the
 * arguments after `board` and prints or sends what comes back.
 */

import { isActivityValue, type ActivityValue } from './activity'

export const BOARD_USAGE = `usage: board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none

  <card>    . for this card, or a card's id or title in this workspace
  <column>  a column title of this workspace (any case)
  <text>    the card's status text; "" clears it
  activity  working, waiting for you, or a question for you; none clears it
`

export type BoardCommand =
  | { command: 'move'; card: string; column: string }
  | { command: 'status'; card: string; text: string }
  | { command: 'activity'; card: string; activity: ActivityValue }

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
  }
  return { kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 }
}
