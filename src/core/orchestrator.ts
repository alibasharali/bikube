/**
 * The workspace's Orchestrator (#81 D4–D11): one card-shaped terminal per local workspace, running
 * an agent in the workspace's folder, not on its board. Its conversation is the workspace's
 * `orchestrator` (D8); its startup command is the app-wide Orchestrator agent setting (D7), passed
 * in by the caller. Plain TS: the renderer and main both run it.
 */
import { CLAUDE_STARTUP, type StartupCommand } from './startup-command'
import { findShellCard } from './workspace-shells'
import type { Card, Workspace } from './workspace-store'

export const ORCHESTRATOR_TITLE = 'Orchestrator'

const PREFIX = 'orchestrator:'

/**
 * The first prompt a preset Orchestrator gets on a fresh start (D15); Claude Code gets its guide
 * from its SessionStart hook instead, and a Custom command nothing.
 */
export const ORCHESTRATOR_FIRST_PROMPT =
  "You are this Bikube workspace's orchestrator. Run: board guide  Read it, then say in one " +
  'line that you are ready.'

/** The Orchestrator's id in workspace `workspaceId` (D4). */
export const orchestratorId = (workspaceId: string): string => `${PREFIX}${workspaceId}`

/** Whether `id` names an Orchestrator (whether or not its workspace exists). */
export const isOrchestratorId = (id: string): boolean => id.startsWith(PREFIX)

/** The workspace id an Orchestrator id names, or null for any other id. */
export const orchestratorWorkspaceId = (id: string): string | null =>
  isOrchestratorId(id) ? id.slice(PREFIX.length) : null

/** Whether the workspace has an Orchestrator: every local one does, an SSH one none (D4, D10). */
export const hasOrchestrator = (workspace: Pick<Workspace, 'host'>): boolean =>
  workspace.host === undefined

/**
 * The workspace's Orchestrator as the card-shaped record the terminals use (D4): titled
 * `Orchestrator`, in the workspace's folder, with its stored conversation (none before its first
 * start) and `startup`, the Orchestrator agent setting. A preset's fresh start passes D15's first
 * prompt. Undefined for an SSH workspace (D10).
 */
export function orchestratorCard(
  workspace: Workspace,
  startup: StartupCommand = CLAUDE_STARTUP
): Card | undefined {
  if (!hasOrchestrator(workspace)) return undefined
  const stored = workspace.orchestrator
  const preset = startup.kind !== 'claude' && startup.kind !== 'custom' && startup.kind !== 'shell'
  return {
    id: orchestratorId(workspace.id),
    columnId: '',
    title: ORCHESTRATOR_TITLE,
    directory: workspace.directory,
    startup,
    agentSessionId: stored?.agentSessionId ?? '',
    claudeStarted: stored?.claudeStarted ?? false,
    startedAgents: [...(stored?.startedAgents ?? [])],
    ...(preset && { firstPrompt: ORCHESTRATOR_FIRST_PROMPT })
  }
}

/** The workspace's Orchestrator when `id` is its id, else undefined. */
export function findOrchestratorCard(
  workspace: Workspace,
  id: string,
  startup?: StartupCommand
): Card | undefined {
  return id === orchestratorId(workspace.id) ? orchestratorCard(workspace, startup) : undefined
}

/**
 * The terminal `id` names in the workspace, as the terminals see it: a card on its board, one of
 * its shells, or its Orchestrator (with `orchestratorStartup`).
 */
export function findTerminalCard(
  workspace: Workspace,
  id: string,
  orchestratorStartup?: StartupCommand
): Card | undefined {
  return (
    workspace.cards.find((c) => c.id === id) ??
    findShellCard(workspace, id) ??
    findOrchestratorCard(workspace, id, orchestratorStartup)
  )
}

/**
 * The agent an Orchestrator runs now (D7): while it runs, the one it started with (`startedWith`,
 * when known), since a changed setting applies only at its next start; else the setting.
 */
export function currentOrchestratorStartup(
  running: boolean,
  startedWith: StartupCommand | undefined,
  setting: StartupCommand
): StartupCommand {
  return running && startedWith ? startedWith : setting
}
