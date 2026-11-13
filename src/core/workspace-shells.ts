/**
 * A workspace's shells as the terminals code sees them: its named and temporary shells, each a
 * card-shaped record with its own id, so they start, show, split and stop exactly like cards. Not
 * on the board. There is no Default shell (#81 D1). Plain TS.
 */
import type { Card, Workspace, WorkspaceShell } from './workspace-store'

/**
 * The worktree card `shell` runs in: its `runIn` card while that card is on the board with its own
 * worktree (local workspaces only), else undefined for the workspace's folder.
 */
export function shellWorktreeCard(workspace: Workspace, shell: WorkspaceShell): Card | undefined {
  if (!shell.runIn || workspace.host !== undefined) return undefined
  return workspace.cards.find((c) => c.id === shell.runIn && c.worktree !== undefined)
}

/** `shell` as a card in the folder it runs in. */
export function shellCard(workspace: Workspace, shell: WorkspaceShell): Card {
  return {
    id: shell.id,
    columnId: '',
    title: shell.name,
    directory: shellWorktreeCard(workspace, shell)?.directory ?? workspace.directory,
    ...(workspace.host !== undefined && { host: workspace.host }),
    startup: shell.command ? { kind: 'custom', command: shell.command } : { kind: 'shell' },
    // A trigger exits when its command ends, with the command's exit code.
    ...(shell.type === 'trigger' && shell.command && { exitAfterStartup: true }),
    agentSessionId: '',
    claudeStarted: false,
    startedAgents: []
  }
}

/** Every shell of the workspace, named and temporary, in strip order. */
export function shellCards(workspace: Workspace): Card[] {
  return workspace.shells.map((s) => shellCard(workspace, s))
}

/**
 * The shells the Shells tab lists (#67 D1): the named shells the user saved. Temporary shells
 * (#66 D2) show only in the sidebar tree and the palette.
 */
export function listedShellCards(workspace: Workspace): Card[] {
  return workspace.shells.filter((s) => !s.temporary).map((s) => shellCard(workspace, s))
}

/** The workspace's shell with this id, or undefined. */
export function findShellCard(workspace: Workspace, id: string): Card | undefined {
  const shell = workspace.shells.find((s) => s.id === id)
  return shell && shellCard(workspace, shell)
}
