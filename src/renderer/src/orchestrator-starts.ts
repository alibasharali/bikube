import type { StartupCommand } from '../../core/startup-command'

/**
 * The agent each Orchestrator was started with (#81 D7), by its id: set at each start and cleared
 * once it stops, so a running Orchestrator keeps its agent whatever the setting says since. Runtime
 * only. No imports beyond types, so the terminals can read it.
 */
const startedWith = new Map<string, StartupCommand>()

/** The agent Orchestrator `id` started with, while it is known. */
export const orchestratorStartedWith = (id: string): StartupCommand | undefined =>
  startedWith.get(id)

/** Records the agent Orchestrator `id` starts with now. */
export function setOrchestratorStartedWith(id: string, startup: StartupCommand): void {
  startedWith.set(id, startup)
}

/** Forgets what Orchestrator `id` started with: it stopped. */
export function forgetOrchestratorStartedWith(id: string): void {
  startedWith.delete(id)
}
