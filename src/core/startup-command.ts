/**
 * Startup commands (#5 D2, D5): what Drovr types into a card's login shell right after it
 * starts. Plain TS: no Electron or Node imports.
 */
import type { FieldError, Result } from './workspace-store'

/** Shell types nothing; Claude Code runs `claude` with the card's agent session id. */
export type StartupCommand =
  | { kind: 'shell' }
  | { kind: 'claude' }
  | { kind: 'custom'; command: string }

export const SHELL_STARTUP: StartupCommand = { kind: 'shell' }

/** The card fields a start depends on. */
export interface StartupState {
  startup: StartupCommand
  /** UUID v4 given at creation and kept for the card's whole life (#5 D4). */
  agentSessionId: string
  /** True once `claude --session-id` was typed for this card (#5 D5). */
  claudeStarted: boolean
}

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

/**
 * The line to type into a freshly started shell, without the trailing Enter (`\r`, #5 D3),
 * or null when nothing is typed (Shell). For Claude Code, writing the first-start line is
 * what the caller then records with `markClaudeStarted`.
 */
export function startLine(card: StartupState): string | null {
  switch (card.startup.kind) {
    case 'shell':
      return null
    case 'claude': {
      const id = card.agentSessionId
      return card.claudeStarted
        ? `claude --resume ${id} || claude --session-id ${id}`
        : `claude --session-id ${id}`
    }
    case 'custom':
      return card.startup.command
  }
}
