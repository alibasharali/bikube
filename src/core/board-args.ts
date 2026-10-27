/**
 * Argument parsing for the `board` command (#9 D1). Plain TS: the CLI entry passes the
 * arguments after `board` and prints or sends what comes back.
 */

import { isActivityValue, type ActivityValue } from './activity'
import type { ClaudeUsage } from './claude-usage-types'

/**
 * What SSH cards' `board` takes (#25): the card commands only, and `description` for their own
 * card (`.` or its id, #69 D5, D9).
 */
export const SSH_BOARD_USAGE = `usage: board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none
       board session <card> <session-id>
       board description .

  <card>       . for this card, or a card's id or title in this workspace
  <column>     a column title of this workspace (any case)
  <text>       the card's status text; "" clears it
  activity     working, waiting for you, or a question for you; none clears it
  session      the Claude Code session the card resumes (Bikube's Claude hooks set it)
  description  prints this card's task description (markdown); nothing when it has none
`

export const BOARD_USAGE = `usage: board workspaces [--json]
       board list [--json]
       board create [--agent <agent>] [--description-file <file>|-]
                    [--worktree [--branch <name>]] <column> <title>
       board rename <card> <title>
       board move <card> <column>
       board status <card> <text>
       board activity <card> working|waiting|question|none
       board session <card> <session-id>
       board description <card>
       board describe <card> <file>|-

  workspaces   every workspace in sidebar order: id, name, local or ssh <host>, directory;
               * marks this card's
  list         a workspace's columns and cards, with each card's id and state
  create       a new card at the bottom of <column>, not started; prints its id and workspace
  --workspace <w>
               on list, create, rename, move, status, description and describe: the workspace
               (its id, or its name in any case) whose card and column titles to use; this
               card's workspace when left out
  --agent <agent>
               claude, codex, gemini, opencode, pi or shell; this card's agent when left out
               (the workspace's default when this card runs a custom command or a shell)
  --description-file <file>|-
               the new card's task description (- reads stdin)
  --worktree [--branch <name>]
               the new card gets its own git worktree on the new branch <name> (else one
               named from its title) when it is first opened; a local workspace in a git
               repository only
  <card>       . for this card, a card's id (in any workspace), or a card's title
  <column>     a column title of the workspace (any case); a move uses the card's own workspace
  <text>       the card's status text; "" clears it
  activity     working, waiting for you, or a question for you; none clears it
  session      the Claude Code session the card resumes (Bikube's Claude hooks set it)
  description  prints the card's task description (markdown); nothing when it has none
  describe     replaces it with the file's text (- reads stdin); an empty file removes it
`

/** What `board create --agent` takes (#69 D8): Claude Code, a preset, or a plain shell. */
export const BOARD_AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'shell'] as const
export type BoardAgent = (typeof BOARD_AGENTS)[number]

export const isBoardAgent = (value: unknown): value is BoardAgent =>
  typeof value === 'string' && (BOARD_AGENTS as readonly string[]).includes(value)

/**
 * `workspace`, on the commands that take it (#69 D6), is the `--workspace` given: an id or a
 * name, resolved by the board. Absent means the calling card's workspace.
 */
export type BoardCommand =
  | { command: 'workspaces'; format: ListFormat }
  | { command: 'list'; format: ListFormat; workspace?: string }
  | {
      command: 'create'
      column: string
      title: string
      workspace?: string
      /** `--agent` (#69 D8); absent: the calling card's agent, or the workspace's default. */
      agent?: BoardAgent
      /** From `--description-file` (#69 D8), read by the CLI; absent for none. */
      description?: string
      /** `--worktree` (#69 D10): its own worktree on first open; absent for none. */
      worktree?: true
      /**
       * `--branch` (only with `--worktree`): the worktree's new branch; absent for the one
       * `suggestBranch` names from the title, filled in by the board before it creates the card.
       */
      branch?: string
    }
  | { command: 'rename'; card: string; title: string; workspace?: string }
  | { command: 'move'; card: string; column: string; workspace?: string }
  | { command: 'status'; card: string; text: string; workspace?: string }
  | { command: 'activity'; card: string; activity: ActivityValue }
  | { command: 'session'; card: string; session: string }
  /** Prints the card's description (#69 D5). */
  | { command: 'description'; card: string; workspace?: string }
  /** Replaces the card's description with `description`, '' removing it (#69 D5). */
  | { command: 'describe'; card: string; description: string; workspace?: string }
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
  /** `board describe <card> <file>|-` (#69 D5): the client reads the file, then sends. */
  | { kind: 'descriptionFile'; card: string; path: string; workspace?: string }
  /**
   * `board create --description-file <file>|-` (#69 D8): the client reads the file, then sends
   * `command` with its text as `description`.
   */
  | {
      kind: 'createWithDescription'
      path: string
      command: Extract<BoardCommand, { command: 'create' }>
    }

/** The commands `--workspace` selects a workspace for (#69 D6). */
const TAKES_WORKSPACE = new Set([
  'list',
  'create',
  'rename',
  'move',
  'status',
  'description',
  'describe'
])

interface Options {
  workspace?: string
  agent?: string
  descriptionFile?: string
  branch?: string
  json?: true
  worktree?: true
}

/**
 * Splits `args` (after the command name) into the options the command takes and its operands:
 * each option at most once, anywhere, until `--`; null for a missing value, a repeated option or
 * an option the command doesn't take. Anything else starting with `--` is an operand.
 */
function splitOptions(
  name: string,
  args: readonly string[]
): { options: Options; operands: string[] } | null {
  const valued: Record<string, keyof Options> = {}
  if (TAKES_WORKSPACE.has(name)) valued['--workspace'] = 'workspace'
  if (name === 'create') {
    valued['--agent'] = 'agent'
    valued['--description-file'] = 'descriptionFile'
    valued['--branch'] = 'branch'
  }
  const takesJson = name === 'list' || name === 'workspaces'
  const options: Options = {}
  const operands: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    const key = valued[arg]
    if (key) {
      if (options[key] !== undefined || i + 1 >= args.length) return null
      ;(options as Record<string, string>)[key] = args[++i]
      continue
    }
    if (takesJson && arg === '--json') {
      if (options.json) return null
      options.json = true
      continue
    }
    if (name === 'create' && arg === '--worktree') {
      if (options.worktree) return null
      options.worktree = true
      continue
    }
    // An option of another command, or one `board` doesn't know: a wrong shape.
    if (KNOWN_OPTIONS.has(arg)) return null
    operands.push(arg)
  }
  return { options, operands }
}

const KNOWN_OPTIONS = new Set([
  '--workspace',
  '--agent',
  '--description-file',
  '--json',
  '--worktree',
  '--branch'
])

const USAGE: BoardArgs = { kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 }

/** What `board <argv...>` asks for: usage (help or a wrong shape) or one command. */
export function parseBoardArgs(argv: readonly string[]): BoardArgs {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === 'help' || argv[0] === '--help'))) {
    return { kind: 'help', stdout: BOARD_USAGE, exitCode: 0 }
  }
  const [name, ...rest] = argv
  const split = splitOptions(name, rest)
  if (!split) return USAGE
  const { options, operands } = split
  const format: ListFormat = options.json ? 'json' : 'text'
  const where = options.workspace !== undefined ? { workspace: options.workspace } : {}
  if (name === 'workspaces' && operands.length === 0) {
    return { kind: 'command', command: { command: 'workspaces', format } }
  }
  if (name === 'list' && operands.length === 0) {
    return { kind: 'command', command: { command: 'list', format, ...where } }
  }
  if (name === 'description' && operands.length === 1) {
    return { kind: 'command', command: { command: 'description', card: operands[0], ...where } }
  }
  if (operands.length !== 2) return USAGE
  const [card, value] = operands
  if (name === 'create') {
    if (options.agent !== undefined && !isBoardAgent(options.agent)) return USAGE
    // A branch names the worktree's: without --worktree there is none (#69 D10).
    if (options.branch !== undefined && !options.worktree) return USAGE
    const command: Extract<BoardCommand, { command: 'create' }> = {
      command: 'create',
      column: card,
      title: value,
      ...where,
      ...(options.agent !== undefined && { agent: options.agent as BoardAgent }),
      ...(options.worktree && { worktree: true as const }),
      ...(options.branch !== undefined && { branch: options.branch })
    }
    if (options.descriptionFile !== undefined) {
      return { kind: 'createWithDescription', path: options.descriptionFile, command }
    }
    return { kind: 'command', command }
  }
  if (name === 'rename')
    return { kind: 'command', command: { command: 'rename', card, title: value, ...where } }
  if (name === 'move')
    return { kind: 'command', command: { command: 'move', card, column: value, ...where } }
  if (name === 'status')
    return { kind: 'command', command: { command: 'status', card, text: value, ...where } }
  if (name === 'activity' && isActivityValue(value))
    return { kind: 'command', command: { command: 'activity', card, activity: value } }
  if (name === 'session' && isSessionId(value))
    return { kind: 'command', command: { command: 'session', card, session: value } }
  if (name === 'setup' && isSetupResult(value))
    return { kind: 'command', command: { command: 'setup', card, result: value } }
  if (name === 'usage') return { kind: 'transcript', card, path: value }
  if (name === 'describe') return { kind: 'descriptionFile', card, path: value, ...where }
  return USAGE
}

/** A Claude Code session id: a UUID, any case. */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}
