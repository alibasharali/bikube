/**
 * Pure state behind the startup command field (#5 D9, D10, D11): a select with Shell, Claude
 * Code and Custom…, and a Command input shown for Custom. The typed command is kept while
 * another choice is selected, so switching back does not lose it.
 */
import type { StartupCommand } from './startup-command'

export type StartupChoice = StartupCommand['kind']

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
  return value === 'claude' || value === 'custom' ? value : 'shell'
}
