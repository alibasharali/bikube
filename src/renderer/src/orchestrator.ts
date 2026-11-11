import { findTerminalCard, isOrchestratorId, orchestratorCard } from '../../core/orchestrator'
import { CLAUDE_STARTUP, type StartupCommand } from '../../core/startup-command'
import type { Card, Workspace } from '../../core/workspace-store'
import { settingsStore, useSettings } from './settings'
import { workspaceStore } from './store'

/**
 * The renderer's view of each workspace's Orchestrator (#81 D4, D7): its card-shaped record with
 * the Orchestrator agent setting read at call time, so a change applies at its next start.
 */

/** What an Orchestrator starts: Settings' Orchestrator agent, Claude Code by default (D7). */
export const orchestratorStartup = (): StartupCommand =>
  settingsStore.get().orchestratorStartup ?? CLAUDE_STARTUP

/** `orchestratorStartup`, re-rendering when it changes. */
export function useOrchestratorStartup(): StartupCommand {
  return useSettings().orchestratorStartup ?? CLAUDE_STARTUP
}

/** The workspace's Orchestrator, or undefined for an SSH workspace (D10). */
export const orchestratorOf = (workspace: Workspace): Card | undefined =>
  orchestratorCard(workspace, orchestratorStartup())

/**
 * The card, shell or Orchestrator `id` names in `workspace`, as the terminals see it; the setting
 * is read only for an Orchestrator's id.
 */
export const findTerminal = (workspace: Workspace, id: string): Card | undefined =>
  findTerminalCard(workspace, id, isOrchestratorId(id) ? orchestratorStartup() : undefined)

/** `findTerminal` in the workspace with id `workspaceId`. */
export function findTerminalIn(workspaceId: string, id: string): Card | undefined {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  return workspace && findTerminal(workspace, id)
}
