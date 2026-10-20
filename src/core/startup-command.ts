/**
 * Startup commands (#5 D2, D5): what Drovr types into a card's login shell right after it
 * starts. Plain TS: no Electron or Node imports.
 */
import { AGENT_PRESETS, type AgentKind } from './agent-presets'
import type { FieldError, Result } from './workspace-store'

/**
 * Shell types nothing; Claude Code runs `claude` with the card's agent session id; an agent
 * preset (#21 D1) runs its plain or resume command.
 */
export type StartupCommand =
  { kind: 'shell' } | { kind: 'claude' } | { kind: AgentKind } | { kind: 'custom'; command: string }

export const SHELL_STARTUP: StartupCommand = { kind: 'shell' }

/** The card fields a start depends on. */
export interface StartupState {
  startup: StartupCommand
  /** UUID v4 given at creation and kept for the card's whole life (#5 D4). */
  agentSessionId: string
  /** True once `claude --session-id` was typed for this card (#5 D5). */
  claudeStarted: boolean
  /** The presets this card has started (#21 D3); missing means none. */
  startedAgents?: readonly AgentKind[]
  /**
   * A workspace shell with Auto close: its Custom command is typed as `<command>; exit`, so the
   * shell exits once the command ends on its own (a Ctrl+C stops the list, keeping the prompt).
   */
  exitAfterStartup?: boolean
  /**
   * The card's pending setup (#39 D2): typed instead of the start line until it succeeds; absent
   * (or empty) means none.
   */
  setup?: string
}

/** An 8-4-4-4-12 hex UUID; anything else is never typed into a shell. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (message: string): { ok: false; error: FieldError } => ({
  ok: false,
  error: { field: 'command', message }
})

/**
 * Validates a startup command and normalizes it: a Custom command is trimmed, required and
 * must be a single line (no `\n` or `\r`; it is typed as if by the user, followed by Enter).
 */
export function checkStartup(startup: StartupCommand): Result<StartupCommand> {
  if (startup.kind !== 'custom') return { ok: true, value: { kind: startup.kind } }
  const command = startup.command.trim()
  if (!command) return fail('Command is required')
  if (/[\r\n]/.test(command)) return fail('Command must be one line')
  return { ok: true, value: { kind: 'custom', command } }
}

export const CLAUDE_STARTUP: StartupCommand = { kind: 'claude' }

/**
 * `checkStartup` for a card or a workspace's default for new cards: a card is an agent session,
 * so `shell` is refused (plain shells are the workspace's Shells).
 */
export function checkCardStartup(startup: StartupCommand): Result<StartupCommand> {
  if (startup.kind === 'shell') return fail('Choose an agent or a custom command')
  return checkStartup(startup)
}

/**
 * The line to type into a freshly started shell, without the trailing Enter (`\r`, #5 D3),
 * or null when nothing is typed (Shell, or Claude Code with an agent session id that is not a
 * UUID, since the id is typed unquoted). Claude Code gets Drovr's hooks with
 * `--settings "$DROVR_CLAUDE_SETTINGS"` (#31 D14), a variable every card's shell has. An agent preset types its plain command until the card
 * has started it, then `<resume> || <plain>` (#21 D2). Writing a first-start line is what the
 * caller then records (`firstStart`).
 */
export function startLine(card: StartupState): string | null {
  switch (card.startup.kind) {
    case 'shell':
      return null
    case 'claude': {
      const id = card.agentSessionId
      if (!UUID.test(id)) return null
      const claude = `claude --settings "$DROVR_CLAUDE_SETTINGS"`
      // Started once its hooks reported a conversation (`board session`): resume it, or start that
      // id fresh when it is gone. Before that, start the id fresh, or resume it when a conversation
      // exists that the hooks couldn't report (no Drovr to reach, an older card).
      return card.claudeStarted
        ? `${claude} --resume ${id} || ${claude} --session-id ${id}`
        : `${claude} --session-id ${id} || ${claude} --resume ${id}`
    }
    case 'custom':
      return card.exitAfterStartup ? `${card.startup.command}; exit` : card.startup.command
    default: {
      const kind = card.startup.kind
      const { plain, resume } = AGENT_PRESETS[kind]
      return card.startedAgents?.includes(kind) ? `${resume} || ${plain}` : plain
    }
  }
}

/** What a first start records: Claude Code's `claudeStarted` or a preset in `startedAgents`. */
export type FirstStart = 'claude' | AgentKind

/**
 * What typing the card's start line records (#5 D5, #21 D3): Claude Code's or the preset's kind
 * when the card has not started it yet, else null. Only meaningful when `startLine` is not null.
 */
export function firstStart(card: StartupState): FirstStart | null {
  switch (card.startup.kind) {
    case 'shell':
    case 'custom':
      return null
    case 'claude':
      // Claude Code is started by its hooks' `board session`, once it has a conversation.
      return null
    default:
      return card.startedAgents?.includes(card.startup.kind) ? null : card.startup.kind
  }
}

/**
 * The line typed instead of the start line while a card has a pending setup (#39 D3), without the
 * trailing Enter: the setup, then `board setup . ok` when it succeeded, else `board setup . failed`.
 */
export function setupLine(setup: string): string {
  return `${setup} && "$DROVR_BIN/board" setup . ok || "$DROVR_BIN/board" setup . failed`
}
