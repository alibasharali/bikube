import { useSyncExternalStore } from 'react'
import type { ClaudeUsage } from '../../core/claude-usage-types'

/**
 * Each running workspace shell's Claude Code session and usage (#75 D3a), as the hooks of Claude
 * Code typed in it last reported them (`board session .`, `board usage .`): runtime only, never
 * in the state file or the Sync folder, forgotten when the shell stops (a restart too) or is
 * removed (`listenForBoardRequests` wires the stop). The Agent tab follows the session and shows the usage's context bar.
 */
export interface ShellAgentReport {
  sessionId?: string
  usage?: ClaudeUsage
}

const reports = new Map<string, ShellAgentReport>()
const listeners = new Set<() => void>()
function changed(): void {
  for (const listener of [...listeners]) listener()
}

/** The shell's report, undefined when it has none; the same object until it changes. */
export function shellAgent(shellId: string): ShellAgentReport | undefined {
  return reports.get(shellId)
}

/** `board session .` from the shell: the session it shows from now on. */
export function setShellSession(shellId: string, sessionId: string): void {
  const current = reports.get(shellId)
  if (current?.sessionId === sessionId) return
  reports.set(shellId, { ...current, sessionId })
  changed()
}

/** `board usage .` from the shell: replaces its usage, or forgets it when nothing was counted. */
export function setShellUsage(shellId: string, usage: ClaudeUsage): void {
  const current = reports.get(shellId)
  if (usage.tokens > 0) reports.set(shellId, { ...current, usage })
  else if (current?.usage === undefined) return
  else reports.set(shellId, current.sessionId === undefined ? {} : { sessionId: current.sessionId })
  changed()
}

/** Forgets the shell's session and usage (it stopped, or was removed). */
export function clearShellAgent(shellId: string): void {
  if (reports.delete(shellId)) changed()
}

/** Calls `listener` on every change to any shell's report. Returns an unsubscribe function. */
export function subscribeShellAgents(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The shell's report, live. */
export function useShellAgent(shellId: string | undefined): ShellAgentReport | undefined {
  return useSyncExternalStore(subscribeShellAgents, () =>
    shellId === undefined ? undefined : shellAgent(shellId)
  )
}
