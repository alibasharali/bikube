/**
 * The sidebar tree's terminals: every running card and shell, in every workspace. Plain TS with
 * no DOM imports: the renderer runs it.
 */
import type { Activity } from './activity'
import type { StartupCommand } from './startup-command'
import { DEFAULT_SHELL_TITLE, shellCards } from './workspace-shells'
import { cardsInColumn, defaultShellId, type Workspace } from './workspace-store'

export interface OpenTerminal {
  kind: 'card' | 'shell'
  workspaceId: string
  cardId: string
  /** The card's title or shell's name; `Default shell` for the Default shell. */
  title: string
  /** What it runs, for its logo and colour: a card's startup command's kind, `shell` for shells. */
  tool: StartupCommand['kind']
  activity?: Activity
}

/**
 * The running cards and shells, by workspace in sidebar order, each workspace's cards in column
 * order, then its shells (the Default shell first).
 */
export function openTerminals(
  workspaces: readonly Workspace[],
  isRunning: (cardId: string) => boolean,
  activity: (cardId: string) => Activity | undefined
): OpenTerminal[] {
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
    ...w.columns.flatMap((column) =>
      cardsInColumn(w, column.id)
        .filter((c) => isRunning(c.id))
        .map((c) => row('card', w, c.id, c.title, c.startup.kind))
    ),
    ...shellCards(w)
      .filter((s) => isRunning(s.id))
      .map((s) =>
        row(
          'shell',
          w,
          s.id,
          s.id === defaultShellId(w.id) ? DEFAULT_SHELL_TITLE : s.title,
          'shell'
        )
      )
  ])
}
