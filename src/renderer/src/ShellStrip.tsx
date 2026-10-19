import { AppWindow, Pencil, Plus, RotateCw, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { shellCards } from '../../core/workspace-shells'
import { defaultShellId, type Card, type Workspace } from '../../core/workspace-store'
import { closeCard, removeShell, restartCard } from './card-actions'
import { useCardRunState } from './card-terminals'
import { openCardWindow, useInWindow } from './card-windows'
import ConfirmDialog from './ConfirmDialog'
import DevServerChips from './DevServerChips'
import { MENU_ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'
import ShellDialog from './ShellDialog'

/**
 * The workspace's shells, above its board: terminals that aren't tasks, such as a dev server or a
 * plain prompt. The Default shell is always there; `+` adds a named one with an optional command.
 * Clicking a shell opens it at full size, starting it when stopped, like a card.
 */
function ShellStrip({
  workspace,
  onOpen
}: {
  workspace: Workspace
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const shells = shellCards(workspace)
  const editingShell =
    editing?.id != null ? (workspace.shells.find((s) => s.id === editing.id) ?? null) : null
  return (
    <div className="shells" role="toolbar" aria-label="Shells" data-testid="shells">
      <span className="shells-label">Shells</span>
      {shells.map((shell) => (
        <ShellChip
          key={shell.id}
          workspace={workspace}
          shell={shell}
          isDefault={shell.id === defaultShellId(workspace.id)}
          onOpen={() => onOpen(shell.id)}
          onEdit={() => setEditing({ id: shell.id })}
        />
      ))}
      <button
        type="button"
        className="icon-btn shells-add"
        data-testid="shell-add"
        aria-label="New shell"
        title="New shell"
        onClick={() => setEditing({ id: null })}
      >
        <Plus {...SMALL_ICON} />
      </button>
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
 * One shell: a dot for running, its name and command, and `In window` while it is in its own
 * window (#53 D7); its menu restarts, closes, opens it in a new window, edits, deletes.
 */
function ShellChip({
  workspace,
  shell,
  isDefault,
  onOpen,
  onEdit
}: {
  workspace: Workspace
  shell: Card
  isDefault: boolean
  onOpen: () => void
  onEdit: () => void
}): React.JSX.Element {
  const running = useCardRunState(shell.id).kind === 'running'
  const inWindow = useInWindow(shell.id)
  const [deleting, setDeleting] = useState(false)
  const command = shell.startup.kind === 'custom' ? shell.startup.command : ''
  return (
    <span className="shell-chip-wrap" data-testid="shell" data-shell-name={shell.title}>
      <button
        type="button"
        className="shell-chip"
        data-testid="shell-open"
        data-running={running}
        title={command ? `${shell.title}: ${command}` : `${shell.title}: a plain shell`}
        onClick={onOpen}
      >
        <span className="shell-dot" aria-hidden="true" />
        {isDefault ? <SquareTerminal {...SMALL_ICON} /> : null}
        <span className="shell-name">{shell.title}</span>
        {command && <span className="shell-command">{command}</span>}
        {inWindow && (
          <span className="card-in-window" data-testid="shell-in-window">
            In window
          </span>
        )}
        <span className="visually-hidden">{running ? ', running' : ', stopped'}</span>
      </button>
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
              onClick={run(() => restartCard(workspace.id, shell.id))}
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
      {/* Its dev servers' chips, right after the shell's own chip while it runs (#49 D7). */}
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
    </span>
  )
}

export default ShellStrip
