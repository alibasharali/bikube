import {
  AppWindow,
  Blocks,
  ChevronRight,
  Columns2,
  Folder,
  Rows2,
  Server,
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import { useEffect } from 'react'
import { portableDirectory as displayPath } from '../../core/sync-file'
import { windowTitle } from '../../core/window-title'
import { DEFAULT_SHELL_TITLE, listedShellCards } from '../../core/workspace-shells'
import { defaultShellId, type Card, type Workspace } from '../../core/workspace-store'
import { BranchChip } from './BranchMenu'
import { ToolIcon } from './AgentLogo'
import { StartupTag } from './CardItem'
import { useBranch } from './branches'
import { cardTerminals, useRunningCount } from './card-terminals'
import { homeDir } from './home'
import { runCardViewAction } from './card-view-actions'
import { ICON, SMALL_ICON } from './icons'
import { PanelTabs, PanelToggle } from './PanelTabs'
import { usePanelWidth } from './panel-width'
import { settingsStore, useSettings } from './settings'
import StatusIcon from './StatusIcon'
import Tooltip from './Tooltip'

/**
 * The app's own title bar, above the sidebar and the main area: it drags the window, leaves room
 * for the macOS window buttons over the sidebar, and names where the user is (the workspace, and
 * the open card with its startup tag). With a card open, the workspace name goes back to its board
 * and a button at the right end shows or hides the side panel (#55 D2).
 * The Agent setup page (#68 D2, opened from the workspace toolbar) reads as an open card does
 * (D3). The window title follows it.
 */
function TitleBar({
  collapsed,
  workspace,
  card,
  isShell = false,
  agentSetup = false,
  onNewShell,
  onBack
}: {
  /** New terminal: the New shell action (#66 D1), as its shortcut runs it. */
  onNewShell: () => void
  /** The workspace shows its Agent setup page (#68 D3). */
  agentSetup?: boolean
  /** The open terminal is one of the workspace's shells, not a card. */
  isShell?: boolean
  collapsed: boolean
  /** Back to the workspace's board, as the Back shortcut does. */
  onBack: () => void
  workspace: Workspace | null | undefined
  card: Card | null
}): React.JSX.Element {
  const title = windowTitle(workspace, card ?? (agentSetup ? { title: AGENT_SETUP } : null))
  // Back goes to the board from an open card or the Agent setup page alike.
  const away = card !== null || agentSetup
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
            {away ? (
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
            {!away && <WorkspaceLocation workspace={workspace} />}
            {!away && dir && branch && <BranchChip key={dir} dir={dir} branch={branch} />}
            {agentSetup && (
              <>
                <ChevronRight {...ICON} className="titlebar-separator" />
                <Blocks {...ICON} className="titlebar-agent-setup-icon" />
                <span className="titlebar-current" data-testid="titlebar-agent-setup-title">
                  {AGENT_SETUP}
                </span>
              </>
            )}
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
          <span className="titlebar-current">Bikube</span>
        )}
        {/* Agent setup shows no side panel (#68 D1): nothing here opens or toggles one. */}
        {workspace && !agentSetup && !sidePanelOpen && <RunningShellsChip workspace={workspace} />}
        {card && <TerminalButtons onNewShell={onNewShell} />}
        {/* On the board as in a card (#57 D4); in the panel's own section while it shows. */}
        {workspace && !agentSetup && !sidePanelOpen && <PanelToggle />}
      </div>
      {workspace && !agentSetup && sidePanelOpen && <PanelSection workspace={workspace} />}
    </header>
  )
}

/**
 * Above the side panel and as wide, from the window's top as the sidebar is: the panel's tabs and
 * the button that hides it.
 */
function PanelSection({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const width = usePanelWidth(window)
  return (
    <div className="titlebar-panel-side" data-testid="titlebar-panel-side" style={{ width }}>
      <PanelTabs workspace={workspace} />
      <PanelToggle />
    </div>
  )
}

/** The title bar's buttons over an open card or shell: what each runs and its tooltip. */
const TERMINAL_BUTTONS: readonly {
  action: 'openShell' | 'splitRight' | 'splitDown' | 'openInWindow'
  testId: string
  label: string
  description: string
  icon: LucideIcon
}[] = [
  {
    action: 'openShell',
    testId: 'titlebar-new-shell',
    label: 'New terminal',
    description: "Opens the workspace's Default shell, or a new shell while that one runs",
    icon: SquareTerminal
  },
  {
    action: 'splitRight',
    testId: 'titlebar-split-right',
    label: 'Split right',
    description: 'Opens a shell beside the focused pane',
    icon: Columns2
  },
  {
    action: 'splitDown',
    testId: 'titlebar-split-down',
    label: 'Split down',
    description: 'Opens a shell below the focused pane',
    icon: Rows2
  },
  {
    action: 'openInWindow',
    testId: 'titlebar-open-in-window',
    label: 'Open in new window',
    description: 'Moves this terminal to a window of its own; it keeps running',
    icon: AppWindow
  }
]

/**
 * With a card or shell open: New terminal, Split right and Split down on its focused pane, and
 * Open in new window, each as its shortcut runs it.
 */
function TerminalButtons({ onNewShell }: { onNewShell: () => void }): React.JSX.Element {
  return (
    <span className="titlebar-terminal-buttons" data-testid="titlebar-terminal-buttons">
      {TERMINAL_BUTTONS.map(({ action, testId, label, description, icon: Icon }) => (
        <Tooltip key={action} label={label} description={description} shortcut={action} align="end">
          <button
            type="button"
            className="icon-btn"
            data-testid={testId}
            aria-label={label}
            onClick={() => (action === 'openShell' ? onNewShell() : runCardViewAction(action))}
          >
            <Icon {...ICON} />
          </button>
        </Tooltip>
      ))}
    </span>
  )
}

/** The page's name everywhere it shows (#68 D4). */
const AGENT_SETUP = 'Agent setup'

/**
 * While the side panel is hidden, how many of the workspace's shells run, with a dot; a click
 * shows the panel on its Shells tab. Nothing when none runs.
 */
function RunningShellsChip({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  // The shells the Shells tab lists (#67 D1), the panel this chip opens.
  const shells = listedShellCards(workspace)
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
      <StatusIcon status="running" />
      {running === 1 ? '1 shell' : `${running} shells`}
    </button>
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
      title={`${workspace.directory}\nOpen in ${window.bikube.platform === 'darwin' ? 'Finder' : 'the file manager'}`}
      onClick={() => window.bikube.app.reveal(workspace.directory)}
    >
      <Folder {...SMALL_ICON} />
      <span className="titlebar-location-text">{displayPath(workspace.directory, homeDir())}</span>
    </button>
  )
}

export default TitleBar
