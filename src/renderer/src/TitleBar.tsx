import { ChevronRight, Folder, Server } from 'lucide-react'
import { useEffect } from 'react'
import { portableDirectory as displayPath } from '../../core/sync-file'
import { windowTitle } from '../../core/window-title'
import type { Card, Workspace } from '../../core/workspace-store'
import { BranchChip } from './BranchMenu'
import { StartupTag } from './CardItem'
import { useBranch } from './branches'
import { homeDir } from './home'
import { ICON, SMALL_ICON } from './icons'

/**
 * The app's own title bar, above the sidebar and the main area: it drags the window, leaves room
 * for the macOS window buttons over the sidebar, and names where the user is (the workspace, and
 * the open card with its startup tag). With a card open, the workspace name goes back to its board.
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
  // A worktree card shows its saved branch until its live one is read (D3).
  const branch = worktree ? (live ?? worktree.worktree!.branch) : live
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
            {!card && <WorkspaceLocation workspace={workspace} />}
            {!card && dir && branch && <BranchChip key={dir} dir={dir} branch={branch} />}
            {card && (
              <>
                <ChevronRight {...ICON} className="titlebar-separator" />
                <span className="titlebar-current" data-testid="titlebar-card">
                  {card.title}
                </span>
                {isShell ? (
                  <span className="card-tag card-tag-shell" data-testid="titlebar-shell-tag">
                    Shell
                  </span>
                ) : (
                  <StartupTag startup={card.startup} />
                )}
                {dir && branch && (
                  <BranchChip key={dir} dir={dir} branch={branch} worktree={worktree !== null} />
                )}
              </>
            )}
          </>
        ) : (
          <span className="titlebar-current">Drovr</span>
        )}
      </div>
    </header>
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
