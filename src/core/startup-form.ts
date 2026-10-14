/**
 * Pure state behind the startup command field (#5 D9, D10, D11; #21 D5): a select with Shell,
 * Claude Code, the agent presets and Custom…, and a Command input shown for Custom. The typed
 * command is kept while another choice is selected, so switching back does not lose it.
 */
import { AGENT_KINDS, AGENT_PRESETS, isAgentKind } from './agent-presets'
import type { StartupCommand } from './startup-command'

export type StartupChoice = StartupCommand['kind']

/** Every select's options, in order (#5 D9, #21 D5). */
export const STARTUP_CHOICES: readonly { choice: StartupChoice; label: string }[] = [
  { choice: 'shell', label: 'Shell' },
  { choice: 'claude', label: 'Claude Code' },
  ...AGENT_KINDS.map((kind) => ({ choice: kind, label: AGENT_PRESETS[kind].label })),
  { choice: 'custom', label: 'Custom…' }
]

/** The hint under the field while a preset is chosen (#21 D4); null for any other choice. */
export function presetHint(choice: StartupChoice): string | null {
  if (!isAgentKind(choice)) return null
  return `Resumes the latest ${AGENT_PRESETS[choice].label} session in the card's directory.`
}

export interface StartupDraft {
  choice: StartupChoice
  command: string
}

/** The field's state for a stored command: its choice, Command prefilled when Custom. */
export function startupDraft(startup: StartupCommand): StartupDraft {
  return { choice: startup.kind, command: startup.kind === 'custom' ? startup.command : '' }
}

/** What the field would start; validate it with `checkStartup`. */
export function draftStartup(draft: StartupDraft): StartupCommand {
  return draft.choice === 'custom'
    ? { kind: 'custom', command: draft.command }
    : { kind: draft.choice }
}

/** Whether two drafts start the same thing (the Command only counts for Custom). */
export function sameDraft(a: StartupDraft, b: StartupDraft): boolean {
  return a.choice === b.choice && (a.choice !== 'custom' || a.command === b.command)
}

/** A select's value as a choice; anything else reads as Shell. */
export function parseChoice(value: string): StartupChoice {
  return value === 'claude' || value === 'custom' || isAgentKind(value) ? value : 'shell'
}
