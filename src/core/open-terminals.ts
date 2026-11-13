/**
 * The sidebar tree's terminals: every running card and shell, in every workspace. Plain TS with
 * no DOM imports: the renderer runs it.
 */
import type { Activity } from './activity'
import { orchestratorCard, orchestratorId } from './orchestrator'
import type { StartupCommand } from './startup-command'
import { shellCards } from './workspace-shells'
import { cardsInColumn, type Workspace } from './workspace-store'

export interface OpenTerminal {
  kind: 'card' | 'shell' | 'orchestrator'
  workspaceId: string
  cardId: string
  /** The card's title or shell's name. */
  title: string
  /** What it runs, for its logo and colour: a card's startup command's kind, `shell` for shells. */
  tool: StartupCommand['kind']
  activity?: Activity
}

/**
 * The running cards and shells, by workspace in sidebar order: each workspace's Orchestrator first
 * (#81 D5, its tool `orchestratorStartup`: the agent it runs, or a function of its id giving it),
 * its cards in column
 * order, then its shells in strip order. A trigger is left out until it has been opened
 * (`opened`).
 */
export function openTerminals(
  workspaces: readonly Workspace[],
  isRunning: (cardId: string) => boolean,
  activity: (cardId: string) => Activity | undefined,
  opened: (shellId: string) => boolean = () => true,
  orchestratorStartup?: StartupCommand | ((orchestratorId: string) => StartupCommand)
): OpenTerminal[] {
  const agentOf = (workspace: Workspace): StartupCommand | undefined =>
    typeof orchestratorStartup === 'function'
      ? orchestratorStartup(orchestratorId(workspace.id))
      : orchestratorStartup
  const row = (
    kind: OpenTerminal['kind'],
    workspace: Workspace,
    cardId: string,
    title: string,
    tool: OpenTerminal['tool']
  ): OpenTerminal => {
    const set = activity(cardId)
    return { kind, workspaceId: workspace.id, cardId, title, tool, ...(set && { activity: set }) }
  }
  return workspaces.flatMap((w) => [
    ...[orchestratorCard(w, agentOf(w))]
      .filter((o) => o !== undefined && isRunning(o.id))
      .map((o) => row('orchestrator', w, o!.id, o!.title, o!.startup.kind)),
    ...w.columns.flatMap((column) =>
      cardsInColumn(w, column.id)
        .filter((c) => isRunning(c.id))
        .map((c) => row('card', w, c.id, c.title, c.startup.kind))
    ),
    ...shellCards(w)
      .filter((s) => isRunning(s.id))
      .filter(
        (s) => w.shells.find((named) => named.id === s.id)?.type !== 'trigger' || opened(s.id)
      )
      .map((s) => row('shell', w, s.id, s.title, 'shell'))
  ])
}
