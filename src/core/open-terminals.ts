/**
 * The sidebar's Open terminals section: every running card and shell, in every workspace. Plain
 * TS with no DOM imports: the renderer runs it.
 */
import type { Activity } from './activity'
import { DEFAULT_SHELL_TITLE, shellCards } from './workspace-shells'
import { cardsInColumn, defaultShellId, type Workspace } from './workspace-store'

export interface OpenTerminal {
  kind: 'card' | 'shell'
  workspaceId: string
  cardId: string
  /** The card's title or shell's name; `Default shell` for the Default shell. */
  title: string
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
    title: string
  ): OpenTerminal => {
    const set = activity(cardId)
    return { kind, workspaceId: workspace.id, cardId, title, ...(set && { activity: set }) }
  }
  return workspaces.flatMap((w) => [
    ...w.columns.flatMap((column) =>
      cardsInColumn(w, column.id)
        .filter((c) => isRunning(c.id))
        .map((c) => row('card', w, c.id, c.title))
    ),
    ...shellCards(w)
      .filter((s) => isRunning(s.id))
      .map((s) =>
        row('shell', w, s.id, s.id === defaultShellId(w.id) ? DEFAULT_SHELL_TITLE : s.title)
      )
  ])
}
