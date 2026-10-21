import { ChevronRight, Folder, PanelRight, Server } from 'lucide-react'
import { useEffect } from 'react'
import { portableDirectory as displayPath } from '../../core/sync-file'
import { windowTitle } from '../../core/window-title'
import { DEFAULT_SHELL_TITLE, shellCards } from '../../core/workspace-shells'
import { defaultShellId, type Card, type Workspace } from '../../core/workspace-store'
import { BranchChip } from './BranchMenu'
import { ToolIcon } from './AgentLogo'
import { StartupTag } from './CardItem'
import { useBranch } from './branches'
import { cardTerminals, useRunningCount } from './card-terminals'
import { homeDir } from './home'
import { ICON, SMALL_ICON } from './icons'
import { settingsStore, useSettings } from './settings'
import { useWorkspaceUsage } from './usage'

/**
 * The app's own title bar, above the sidebar and the main area: it drags the window, leaves room
 * for the macOS window buttons over the sidebar, and names where the user is (the workspace, and
 * the open card with its startup tag). With a card open, the workspace name goes back to its board
 * and a button at the right end shows or hides the side panel (#55 D2).
 * The window title follows it.
 */
function TitleBar({
  collapsed,
  workspace,
  card,
  isShell = false,
  onBack
}: {
  /** The open terminal is one of the workspace's shells, not a card. */
  isShell?: boolean
  collapsed: boolean
  /** Back to the workspace's board, as the Back shortcut does. */
  onBack: () => void
  workspace: Workspace | null | undefined
  card: Card | null
}): React.JSX.Element {
  const title = windowTitle(workspace, card)
  // The branch where what is shown runs, and where the branch menu acts (#33 D2): an open worktree
  // card's own directory, else the workspace's folder. Local workspaces only (D11).
  const local = workspace && workspace.host === undefined ? workspace : null
  const worktree = local && card?.worktree ? card : null
  const dir = worktree ? worktree.directory : (local?.directory ?? null)
  const live = useBranch(dir)
  // A worktree card shows its saved branch until its live one is first read (D3); then none when
  // its directory is no longer a repository.
  const branch = worktree && live === undefined ? worktree.worktree!.branch : live
  const { sidePanelOpen } = useSettings()
  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <header className="titlebar" data-testid="titlebar">
      <div className={collapsed ? 'titlebar-side titlebar-side-collapsed' : 'titlebar-side'} />
      <div className="titlebar-main" data-testid="titlebar-title">
        {workspace ? (
          <>
            {card ? (
              <button
                type="button"
                className="titlebar-workspace"
                data-testid="titlebar-workspace"
                title={`Back to ${workspace.name}`}
                onClick={onBack}
              >
                {workspace.name}
              </button>
            ) : (
              <span className="titlebar-current" data-testid="board-title">
                {workspace.name}
              </span>
            )}
            {!card && <WorkspaceUsageChip workspace={workspace} />}
            {!card && <WorkspaceLocation workspace={workspace} />}
            {!card && dir && branch && <BranchChip key={dir} dir={dir} branch={branch} />}
            {card && (
              <>
                <ChevronRight {...ICON} className="titlebar-separator" />
                {isShell ? (
                  <span
                    className="card-tag card-tag-shell"
                    data-testid="titlebar-shell-tag"
                    title="Shell"
                  >
                    <ToolIcon tool="shell" />
                    <span className="visually-hidden">Shell</span>
                  </span>
                ) : (
                  <StartupTag startup={card.startup} />
                )}
                <span className="titlebar-current" data-testid="titlebar-card">
                  {card.title}
                </span>
                {dir && branch && (
                  <BranchChip key={dir} dir={dir} branch={branch} worktree={worktree !== null} />
                )}
              </>
            )}
          </>
        ) : (
          <span className="titlebar-current">Drovr</span>
        )}
        {workspace && !sidePanelOpen && <RunningShellsChip workspace={workspace} />}
        {/* On the board as in a card (#57 D4). */}
        {workspace && (
          <button
            type="button"
            className="icon-btn titlebar-panel"
            data-testid="titlebar-panel"
            aria-label="Side panel"
            aria-pressed={sidePanelOpen}
            title={sidePanelOpen ? 'Hide panel' : 'Show panel'}
            onClick={() => settingsStore.update({ sidePanelOpen: !sidePanelOpen })}
          >
            <PanelRight {...ICON} />
          </button>
        )}
      </div>
    </header>
  )
}

/**
 * While the side panel is hidden, how many of the workspace's shells run, with a dot; a click
 * shows the panel on its Shells tab. Nothing when none runs.
 */
function RunningShellsChip({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const shells = shellCards(workspace)
  const running = useRunningCount(shells)
  if (running === 0) return null
  const names = shells
    .filter((s) => cardTerminals().runState(s.id)?.kind === 'running')
    .map((s) => (s.id === defaultShellId(workspace.id) ? DEFAULT_SHELL_TITLE : s.title))
  return (
    <button
      type="button"
      className="titlebar-shells"
      data-testid="titlebar-shells"
      title={`Running: ${names.join(', ')}. Show them in the panel`}
      onClick={() => settingsStore.update({ sidePanelOpen: true, sidePanelTab: 'shells' })}
    >
      <span className="shell-dot" aria-hidden="true" />
      {running === 1 ? '1 shell' : `${running} shells`}
    </button>
  )
}

/**
 * The Claude Code usage of the workspace's cards (#50 D9): the sum of their known costs, else of
 * their tokens. Nothing when no card has usage.
 */
function WorkspaceUsageChip({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const usage = useWorkspaceUsage(workspace.cards.map((c) => c.id))
  if (!usage) return null
  return (
    <span className="titlebar-usage" data-testid="titlebar-usage" title={usage.tooltip}>
      {usage.text}
    </span>
  )
}

/**
 * Where the workspace is: a local folder (with `~` for the home folder) that opens in the file
 * manager when clicked, or an SSH workspace's `host:path` with the server icon.
 */
function WorkspaceLocation({ workspace }: { workspace: Workspace }): React.JSX.Element {
  if (workspace.host !== undefined) {
    return (
      <span
        className="titlebar-location"
        title={`SSH: ${workspace.host}`}
        data-testid="board-location"
      >
        <Server {...SMALL_ICON} />
        <span className="titlebar-location-text">
          {workspace.host}:{workspace.directory}
        </span>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="titlebar-location titlebar-location-button"
      data-testid="board-location"
      title={`${workspace.directory}\nOpen in ${window.drovr.platform === 'darwin' ? 'Finder' : 'the file manager'}`}
      onClick={() => window.drovr.app.reveal(workspace.directory)}
    >
      <Folder {...SMALL_ICON} />
      <span className="titlebar-location-text">{displayPath(workspace.directory, homeDir())}</span>
    </button>
  )
}

export default TitleBar
