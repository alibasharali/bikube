/**
 * A workspace's shells as the terminals code sees them: the Default shell (a plain shell in the
 * workspace's folder, never stored) and its named shells, each a card-shaped record with its own
 * id, so they start, show, split and stop exactly like cards. Not on the board. Plain TS.
 */
import { defaultShellId, type Card, type Workspace, type WorkspaceShell } from './workspace-store'

export const DEFAULT_SHELL_NAME = 'Default'

/** The Default shell's name where it stands alone: the palette's rows, its own window's title. */
export const DEFAULT_SHELL_TITLE = 'Default shell'

/** `shell` (or the Default shell for null) as a card in the workspace's folder. */
export function shellCard(workspace: Workspace, shell: WorkspaceShell | null): Card {
  return {
    id: shell?.id ?? defaultShellId(workspace.id),
    columnId: '',
    title: shell?.name ?? DEFAULT_SHELL_NAME,
    directory: workspace.directory,
    ...(workspace.host !== undefined && { host: workspace.host }),
    startup: shell?.command ? { kind: 'custom', command: shell.command } : { kind: 'shell' },
    agentSessionId: '',
    claudeStarted: false,
    startedAgents: []
  }
}

/** Every shell of the workspace, the Default one first. */
export function shellCards(workspace: Workspace): Card[] {
  return [shellCard(workspace, null), ...workspace.shells.map((s) => shellCard(workspace, s))]
}

/** The workspace's shell with this id (the Default one included), or undefined. */
export function findShellCard(workspace: Workspace, id: string): Card | undefined {
  if (id === defaultShellId(workspace.id)) return shellCard(workspace, null)
  const shell = workspace.shells.find((s) => s.id === id)
  return shell && shellCard(workspace, shell)
}
