import {
  AppWindow,
  Check,
  Folder,
  Moon,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2,
  TreePine
} from 'lucide-react'
import { useRef, useState } from 'react'
import { shellCards, shellWorktreeCard } from '../../core/workspace-shells'
import { defaultShellId, type Card, type Workspace } from '../../core/workspace-store'
import { startInBackground } from './background-shells'
import { closeCard, removeShell, restartCard, startCard } from './card-actions'
import { useCardRunState } from './card-terminals'
import { openCardWindow, useInWindow } from './card-windows'
import ConfirmDialog from './ConfirmDialog'
import DevServerChips from './DevServerChips'
import { MENU_ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'
import ShellDialog from './ShellDialog'
import { workspaceStore } from './store'

/**
 * The side panel's Shells tab: the workspace's shells, terminals that aren't tasks (a dev server,
 * a test watcher, a plain prompt), one row each with what it runs, where, and its dev servers.
 * The Default shell is always first; New shell adds a named one. A click on a row opens the shell,
 * starting it when stopped (a background shell's first click only starts it). Beside a worktree
 * card, each named shell offers Run here: from then on it runs in that card's worktree.
 */
function ShellsTab({
  workspace,
  worktreeCard,
  onOpen
}: {
  workspace: Workspace
  /** The worktree card open beside the panel, whose worktree Run here moves a shell into. */
  worktreeCard?: Card
  onOpen: (shellId: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const editingShell =
    editing?.id != null ? (workspace.shells.find((s) => s.id === editing.id) ?? null) : null
  return (
    <div className="shells-tab" data-testid="shells">
      <div className="shells-tab-header">
        <button
          type="button"
          className="btn btn-small shells-add"
          data-testid="shell-add"
          onClick={() => setEditing({ id: null })}
        >
          <Plus {...SMALL_ICON} />
          New shell
        </button>
      </div>
      <ul className="shell-rows" aria-label="Shells">
        {shellCards(workspace).map((shell) => (
          <ShellRow
            key={shell.id}
            workspace={workspace}
            shell={shell}
            worktreeCard={worktreeCard}
            onOpen={() => onOpen(shell.id)}
            onEdit={() => setEditing({ id: shell.id })}
          />
        ))}
      </ul>
      {editing && (
        <ShellDialog
          workspaceId={workspace.id}
          shell={editingShell}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * Moves a named shell to `cardId`'s worktree (null: the workspace's folder): a running shell
 * starts again there; `start` starts a stopped one too (a background shell in the background).
 */
function runShellIn(
  workspace: Workspace,
  shellId: string,
  cardId: string | null,
  running: boolean,
  start: boolean
): void {
  if (!workspaceStore.setShellRunIn(workspace.id, shellId, cardId).ok) return
  if (running) restartCard(workspace.id, shellId)
  else if (start) {
    const background = workspace.shells.find((s) => s.id === shellId)?.background
    if (background) startInBackground(workspace.id, shellId)
    else startCard(workspace.id, shellId)
  }
}

/**
 * One shell: its status dot, name and markers (background, autostart, `In window`), its command,
 * the worktree it runs in, its buttons (Start or Stop, Run here) and menu, and its dev servers.
 * A right-click opens the menu.
 */
function ShellRow({
  workspace,
  shell,
  worktreeCard,
  onOpen,
  onEdit
}: {
  workspace: Workspace
  shell: Card
  worktreeCard?: Card
  onOpen: () => void
  onEdit: () => void
}): React.JSX.Element {
  const running = useCardRunState(shell.id).kind === 'running'
  const inWindow = useInWindow(shell.id)
  const [deleting, setDeleting] = useState(false)
  const row = useRef<HTMLLIElement>(null)
  const isDefault = shell.id === defaultShellId(workspace.id)
  const named = workspace.shells.find((s) => s.id === shell.id) ?? null
  const background = named?.background === true
  const startsHidden = background && !running
  const command = shell.startup.kind === 'custom' ? shell.startup.command : ''
  const where = shellWorktreeCard(workspace, named)
  // Worktree cards a named shell can run in (local workspaces only).
  const worktreeCards =
    named && workspace.host === undefined ? workspace.cards.filter((c) => c.worktree) : []
  const runHere =
    named !== null && worktreeCard?.worktree !== undefined && where?.id !== worktreeCard.id
  const start = (): void =>
    startsHidden ? startInBackground(workspace.id, shell.id) : startCard(workspace.id, shell.id)

  return (
    <li
      ref={row}
      className="shell-row"
      data-testid="shell"
      data-shell-name={shell.title}
      data-running={running}
      onContextMenu={(e) => {
        e.preventDefault()
        row.current?.querySelector<HTMLElement>('[data-testid="shell-menu"]')?.click()
      }}
    >
      <button
        type="button"
        className="shell-row-open"
        data-testid="shell-open"
        data-running={running}
        data-background={background || undefined}
        title={
          startsHidden
            ? `Start ${shell.title} in the background; click again to open it`
            : `Open ${shell.title}`
        }
        onClick={startsHidden ? start : onOpen}
      >
        <span className="shell-row-head">
          <span className="shell-dot" aria-hidden="true" />
          {isDefault && <SquareTerminal {...SMALL_ICON} />}
          <span className="shell-name">{isDefault ? 'Default shell' : shell.title}</span>
          {background && (
            <span className="shell-marker" title="Starts in the background">
              <Moon {...SMALL_ICON} aria-label="Starts in the background" />
            </span>
          )}
          {named?.autostart && (
            <span className="shell-marker" title="Starts when the workspace opens">
              <Power {...SMALL_ICON} aria-label="Starts when the workspace opens" />
            </span>
          )}
          {inWindow && (
            <span className="card-in-window" data-testid="shell-in-window">
              In window
            </span>
          )}
          <span className="visually-hidden">{running ? ', running' : ', stopped'}</span>
        </span>
        <span className="shell-command" data-testid="shell-row-command">
          {command || 'Plain shell'}
        </span>
        {where?.worktree && !runHere && (
          <span className="shell-where" data-testid="shell-where" title={where.directory}>
            <TreePine {...SMALL_ICON} />
            <span>{where.worktree.branch}</span>
          </span>
        )}
      </button>
      <span className="shell-row-actions">
        {running ? (
          <button
            type="button"
            className="icon-btn"
            data-testid="shell-stop"
            aria-label={`Stop ${shell.title}`}
            title="Stop"
            onClick={() => closeCard(shell.id)}
          >
            <Square {...SMALL_ICON} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            data-testid="shell-start"
            aria-label={`Start ${shell.title}`}
            title="Start without opening"
            onClick={start}
          >
            <Play {...SMALL_ICON} />
          </button>
        )}
        <MenuButton
          className="shell-menu-wrap"
          label={`Shell menu for ${shell.title}`}
          menuLabel={`${shell.title} actions`}
          testId="shell-menu"
          fixed
        >
          {(run) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="shell-menu-restart"
                onClick={run(() =>
                  startsHidden
                    ? startInBackground(workspace.id, shell.id)
                    : restartCard(workspace.id, shell.id)
                )}
              >
                <RotateCw {...MENU_ICON} />
                {running ? 'Restart' : 'Start'}
              </button>
              {running && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid="shell-menu-close"
                  onClick={run(() => closeCard(shell.id))}
                >
                  <Square {...MENU_ICON} />
                  Close
                </button>
              )}
              {/* Started first when stopped; brought forward when it has a window already (#53 D6). */}
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="shell-menu-open-window"
                onClick={run(() => openCardWindow(workspace.id, shell.id))}
              >
                <AppWindow {...MENU_ICON} />
                Open in new window
              </button>
              {worktreeCards.length > 0 && (
                <div className="menu-group" role="group" aria-label="Run in">
                  <p className="menu-label" aria-hidden="true">
                    Run in
                  </p>
                  {[null, ...worktreeCards].map((c) => {
                    const current = (where?.id ?? null) === (c?.id ?? null)
                    return (
                      <button
                        key={c?.id ?? 'workspace'}
                        type="button"
                        role="menuitemradio"
                        aria-checked={current}
                        className="menu-item menu-item-checkable"
                        data-testid="shell-menu-run-in"
                        onClick={run(() =>
                          runShellIn(workspace, shell.id, c?.id ?? null, running, false)
                        )}
                      >
                        {current ? (
                          <Check {...MENU_ICON} />
                        ) : (
                          <span className="branch-menu-spacer" aria-hidden="true" />
                        )}
                        {c ? `${c.title} · ${c.worktree?.branch}` : 'Workspace folder'}
                      </button>
                    )
                  })}
                </div>
              )}
              {!isDefault && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    data-testid="shell-menu-edit"
                    onClick={run(onEdit)}
                  >
                    <Pencil {...MENU_ICON} />
                    Edit…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item menu-item-danger"
                    data-testid="shell-menu-delete"
                    onClick={run(() =>
                      running ? setDeleting(true) : removeShell(workspace.id, shell.id)
                    )}
                  >
                    <Trash2 {...MENU_ICON} />
                    Delete
                  </button>
                </>
              )}
            </>
          )}
        </MenuButton>
      </span>
      {runHere && worktreeCard?.worktree && (
        <span className="shell-run-here-line">
          {where?.worktree ? <TreePine {...SMALL_ICON} /> : <Folder {...SMALL_ICON} />}
          <span className="shell-run-here-from">
            {where?.worktree ? where.worktree.branch : 'workspace folder'}
          </span>
          <button
            type="button"
            className="shell-run-here"
            data-testid="shell-run-here"
            title={`Run ${shell.title} in ${worktreeCard.title}'s worktree (${worktreeCard.worktree.branch})`}
            onClick={() => runShellIn(workspace, shell.id, worktreeCard.id, running, true)}
          >
            Run here
          </button>
        </span>
      )}
      {running && <DevServerChips cardId={shell.id} />}
      {deleting && (
        <ConfirmDialog
          title="Delete shell"
          message={`Delete "${shell.title}"? It is still running and will be stopped.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false)
            removeShell(workspace.id, shell.id)
          }}
        />
      )}
    </li>
  )
}

export default ShellsTab
