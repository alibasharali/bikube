import {
  currentOrchestratorStartup,
  findTerminalCard,
  isOrchestratorId,
  orchestratorCard,
  orchestratorId
} from '../../core/orchestrator'
import { CLAUDE_STARTUP, type StartupCommand } from '../../core/startup-command'
import type { Card, Workspace } from '../../core/workspace-store'
import { cardTerminals } from './card-terminals'
import {
  forgetOrchestratorStartedWith,
  orchestratorStartedWith,
  setOrchestratorStartedWith
} from './orchestrator-starts'
import { settingsStore, useSettings } from './settings'
import { workspaceStore } from './store'

/**
 * The renderer's view of each workspace's Orchestrator (#81 D4, D7): its card-shaped record with
 * the Orchestrator agent setting read at call time, so a change applies at its next start, while a
 * running one keeps the agent it started with.
 */

/** What an Orchestrator starts: Settings' Orchestrator agent, Claude Code by default (D7). */
export const orchestratorStartup = (): StartupCommand =>
  settingsStore.get().orchestratorStartup ?? CLAUDE_STARTUP

/** `orchestratorStartup`, re-rendering when it changes. */
export function useOrchestratorStartup(): StartupCommand {
  return useSettings().orchestratorStartup ?? CLAUDE_STARTUP
}

/**
 * What Orchestrator `id` runs now (D7): the agent it started with while it runs, else the setting
 * its next start will use.
 */
export function orchestratorStartupOf(id: string): StartupCommand {
  const running = cardTerminals().runState(id)?.kind === 'running'
  return currentOrchestratorStartup(running, orchestratorStartedWith(id), orchestratorStartup())
}

let tracking = false

/**
 * Records the agent Orchestrator `id` starts with now; forgotten once it stops, after every other
 * listener of the stop (a transcript backup) has read it.
 */
export function rememberOrchestratorStart(id: string, startup: StartupCommand): void {
  setOrchestratorStartedWith(id, startup)
  if (tracking) return
  tracking = true
  cardTerminals().onEnded((cardId) => {
    if (!isOrchestratorId(cardId)) return
    queueMicrotask(() => {
      if (cardTerminals().runState(cardId)?.kind !== 'running') {
        forgetOrchestratorStartedWith(cardId)
      }
    })
  })
}

/** The workspace's Orchestrator as it runs now, or undefined for an SSH workspace (D10). */
export const orchestratorOf = (workspace: Workspace): Card | undefined =>
  orchestratorCard(workspace, orchestratorStartupOf(orchestratorId(workspace.id)))

/**
 * The card, shell or Orchestrator `id` names in `workspace`, as the terminals see it; an
 * Orchestrator's agent is `orchestratorStartupOf`'s, read only for its id.
 */
export const findTerminal = (workspace: Workspace, id: string): Card | undefined =>
  findTerminalCard(workspace, id, isOrchestratorId(id) ? orchestratorStartupOf(id) : undefined)

/** `findTerminal` in the workspace with id `workspaceId`. */
export function findTerminalIn(workspaceId: string, id: string): Card | undefined {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  return workspace && findTerminal(workspace, id)
}
