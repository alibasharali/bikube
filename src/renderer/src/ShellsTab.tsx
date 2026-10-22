import {
  AppWindow,
  Check,
  ChevronDown,
  Folder,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2,
  TreePine,
  X,
  Zap
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  failureHeading,
  triggerStatus,
  triggerStatusLabel,
  type TriggerStatus
} from '../../core/trigger-status'
import { shellCards, shellWorktreeCard } from '../../core/workspace-shells'
import { defaultShellId, type Card, type Workspace } from '../../core/workspace-store'
import { startInBackground } from './background-shells'
import { closeCard, removeShell, restartCard, startCard } from './card-actions'
import { useCardRunState } from './card-terminals'
import { openCardWindow, useInWindow } from './card-windows'
import ConfirmDialog from './ConfirmDialog'
import DevServerChips from './DevServerChips'
import { useDevServers } from './dev-servers'
import { MENU_ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'
import Modal from './Modal'
import ShellDialog from './ShellDialog'
import { useTriggerFailureRequest } from './trigger-failures'
import StatusIcon from './StatusIcon'
import { workspaceStore } from './store'

/**
 * The side panel's Shells tab: the workspace's shells, terminals that aren't tasks (a dev server,
 * a test watcher, a plain prompt), one row each with what it runs, where, and its dev servers.
 * The Default shell is always first; New shell adds a named one. A click on a row opens the shell,
 * starting it when stopped (a trigger's click runs it in the background unless it runs). Beside a worktree
 * card, each named shell's Start dropdown offers Run in this worktree: from then on it runs in
 * that card's worktree.
 */
function ShellsTab({
  workspace,
  worktreeCard,
  onOpen
}: {
  workspace: Workspace
  /** The worktree card open beside the panel, whose worktree Run in this worktree moves a shell into. */
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

/** A folder's last name: `/home/me/drovr/` → `drovr`. */
function folderName(directory: string): string {
  return directory.replace(/\/+$/, '').split('/').pop() || directory
}

/**
 * Moves a named shell to `cardId`'s worktree (null: the workspace's folder): a running shell
 * starts again there, unless it runs there already; `start` starts a stopped one too (a trigger
 * in the background).
 */
function runShellIn(
  workspace: Workspace,
  shellId: string,
  cardId: string | null,
  running: boolean,
  start: boolean
): void {
  const named = workspace.shells.find((s) => s.id === shellId) ?? null
  const moved = (shellWorktreeCard(workspace, named)?.id ?? null) !== cardId
  if (!workspaceStore.setShellRunIn(workspace.id, shellId, cardId).ok) return
  if (running) {
    if (moved) restartCard(workspace.id, shellId)
  } else if (start) {
    const trigger = workspace.shells.find((s) => s.id === shellId)?.type === 'trigger'
    if (trigger) startInBackground(workspace.id, shellId)
    else startCard(workspace.id, shellId)
  }
}

/**
 * One shell: its status (a dot for a shell; a trigger's idle, running, serving, done or failed),
 * its type's icon, name and markers (autostart, `In window`), its command, its Start or Stop
 * (with the dropdown picking where it runs) and menu, where it runs while it runs, and its dev
 * servers. A right-click opens
 * the menu. A trigger's click runs it in the background unless it runs, then opens it.
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
  const runState = useCardRunState(shell.id)
  const running = runState.kind === 'running'
  const listening = useDevServers(shell.id)
  const inWindow = useInWindow(shell.id)
  const [deleting, setDeleting] = useState(false)
  const row = useRef<HTMLLIElement>(null)
  const isDefault = shell.id === defaultShellId(workspace.id)
  const named = workspace.shells.find((s) => s.id === shell.id) ?? null
  const trigger = named?.type === 'trigger'
  const startsHidden = trigger && !running
  const command = shell.startup.kind === 'custom' ? shell.startup.command : ''
  const status = trigger ? triggerStatus(runState, listening) : null
  const where = shellWorktreeCard(workspace, named)
  // Worktree cards a named shell can run in (local workspaces only).
  const worktreeCards =
    named && workspace.host === undefined ? workspace.cards.filter((c) => c.worktree) : []
  // A named shell of a local workspace can move to a worktree: its button gets a dropdown.
  const movable = named !== null && workspace.host === undefined
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
        data-type={named?.type ?? 'shell'}
        title={
          startsHidden
            ? `Run ${shell.title} in the background; click it while it runs to open it`
            : `Open ${shell.title}`
        }
        onClick={startsHidden ? start : onOpen}
      >
        <span className="shell-row-head">
          {trigger ? (
            <TriggerStatusIcon status={status ?? { kind: 'idle' }} />
          ) : (
            <span className="shell-dot" aria-hidden="true" />
          )}
          <span className="shell-type-icon" title={trigger ? 'Trigger' : 'Shell'}>
            {trigger ? <Zap {...SMALL_ICON} /> : <SquareTerminal {...SMALL_ICON} />}
          </span>
          <span className="shell-name">{isDefault ? 'Default shell' : shell.title}</span>
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
      </button>
      <span className="shell-row-actions">
        <span className={movable ? 'split-btn' : 'split-btn split-btn-single'}>
          {running ? (
            <button
              type="button"
              className="split-btn-main"
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
              className="split-btn-main"
              data-testid="shell-start"
              data-worktree={where?.worktree ? 'true' : undefined}
              aria-label={`Start ${shell.title}`}
              title={
                where?.worktree
                  ? `Start in ${where.worktree.branch}, without opening`
                  : 'Start without opening'
              }
              onClick={start}
            >
              <Play {...SMALL_ICON} />
              {where?.worktree && <TreePine {...SMALL_ICON} />}
            </button>
          )}
          {movable && (
            <MenuButton
              className="split-btn-menu"
              buttonClassName="split-btn-toggle"
              icon={<ChevronDown size={12} aria-hidden="true" />}
              label={`Where ${shell.title} runs`}
              menuLabel={`Where ${shell.title} runs`}
              testId="shell-run-menu"
              fixed
            >
              {(run) => {
                const mark = (checked: boolean): React.JSX.Element =>
                  checked ? (
                    <Check {...MENU_ICON} />
                  ) : (
                    <span className="branch-menu-spacer" aria-hidden="true" />
                  )
                // Set to a worktree card that isn't the one open: listed too, checked.
                const elsewhere = where && where.id !== worktreeCard?.id ? where : undefined
                return (
                  <>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={!where}
                      className="menu-item"
                      data-testid="shell-run-workspace"
                      onClick={run(() => runShellIn(workspace, shell.id, null, running, false))}
                    >
                      {mark(!where)}
                      Run in workspace folder
                    </button>
                    {elsewhere?.worktree && (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked="true"
                        className="menu-item"
                        data-testid="shell-run-elsewhere"
                        onClick={run(() => {})}
                      >
                        {mark(true)}
                        {`Run in ${elsewhere.worktree.branch}`}
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={where !== undefined && where.id === worktreeCard?.id}
                      className="menu-item"
                      data-testid="shell-run-here"
                      disabled={!worktreeCard?.worktree}
                      title={
                        worktreeCard?.worktree
                          ? `Run ${shell.title} in ${worktreeCard.worktree.branch}`
                          : 'Open a card with its own worktree to run it there'
                      }
                      onClick={run(() =>
                        worktreeCard
                          ? runShellIn(workspace, shell.id, worktreeCard.id, running, false)
                          : undefined
                      )}
                    >
                      {mark(where !== undefined && where.id === worktreeCard?.id)}
                      Run in this worktree
                    </button>
                  </>
                )
              }}
            </MenuButton>
          )}
        </span>
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
      {/* Where it runs, while it runs. */}
      {running && (
        <span
          className="shell-where"
          data-testid="shell-where"
          data-worktree={where?.worktree ? 'true' : undefined}
          title={where?.directory ?? workspace.directory}
        >
          {where?.worktree ? <TreePine {...SMALL_ICON} /> : <Folder {...SMALL_ICON} />}
          <span className="shell-where-text" data-testid="shell-where-text">
            {where?.worktree ? where.worktree.branch : `/${folderName(workspace.directory)}`}
          </span>
        </span>
      )}
      {running && <DevServerChips cardId={shell.id} />}
      {status?.kind === 'failed' && (
        <TriggerFailure
          title={shell.title}
          command={command}
          status={status}
          shellId={shell.id}
          onRunAgain={() => startInBackground(workspace.id, shell.id)}
        />
      )}
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

/**
 * A failed trigger under its row: its last line, a click (or its notification's) opening what it
 * printed in a dialog, scrolled to the end, with Copy and Run again (its shell, and so its screen,
 * is gone once the command ends).
 */
function TriggerFailure({
  title,
  command,
  status,
  shellId,
  onRunAgain
}: {
  title: string
  command: string
  status: Extract<TriggerStatus, { kind: 'failed' }>
  shellId: string
  onRunAgain: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const output = useRef<HTMLPreElement>(null)
  const heading = failureHeading(status)
  useTriggerFailureRequest(
    shellId,
    useCallback(() => setOpen(true), [])
  )
  // The error is usually at the end.
  useEffect(() => {
    if (open && output.current) output.current.scrollTop = output.current.scrollHeight
    if (!open) setCopied(false)
  }, [open])
  return (
    <div className="trigger-failure" data-testid="trigger-failure">
      <button
        type="button"
        className="trigger-failure-toggle"
        data-testid="trigger-failure-toggle"
        title="Show output"
        onClick={() => setOpen(true)}
      >
        <span className="trigger-failure-line" data-testid="trigger-failure-line">
          {status.line || heading}
        </span>
      </button>
      {open && (
        <Modal
          title={`${title}: ${heading}`}
          onClose={() => setOpen(false)}
          testId="trigger-failure-dialog"
          className="modal-output"
          closeOnOutsideClick
        >
          {command && (
            <p className="trigger-failure-command" data-testid="trigger-failure-command">
              {command}
            </p>
          )}
          {status.tail.length > 0 ? (
            <pre
              ref={output}
              className="trigger-failure-output"
              data-testid="trigger-failure-output"
            >
              {status.tail.join('\n')}
            </pre>
          ) : (
            <p className="modal-message" data-testid="trigger-failure-empty">
              It printed nothing.
            </p>
          )}
          <div className="modal-actions">
            {status.tail.length > 0 && (
              <button
                type="button"
                className="btn"
                data-testid="trigger-failure-copy"
                onClick={() => {
                  void window.drovr.clipboard.write(status.tail.join('\n'))
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              data-testid="trigger-failure-close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="trigger-failure-run"
              onClick={() => {
                setOpen(false)
                onRunAgain()
              }}
            >
              Run again
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * A trigger's status: a hollow dot before its first run (or after a Close), a spinner while its
 * command runs, the running dot once a dev server it printed listens, a check when it ended with
 * 0 and a cross otherwise, named by its tooltip (the exit code and last line).
 */
function TriggerStatusIcon({ status }: { status: TriggerStatus }): React.JSX.Element {
  const label = triggerStatusLabel(status)
  return (
    <span
      className="trigger-status"
      data-testid="trigger-status"
      data-status={status.kind}
      title={label}
      aria-label={label}
    >
      {status.kind === 'running' ? (
        <LoaderCircle {...SMALL_ICON} />
      ) : status.kind === 'serving' ? (
        <StatusIcon status="running" />
      ) : status.kind === 'done' ? (
        <Check {...SMALL_ICON} />
      ) : status.kind === 'failed' ? (
        <X {...SMALL_ICON} />
      ) : (
        <span className="shell-dot" aria-hidden="true" />
      )}
    </span>
  )
}

export default ShellsTab
