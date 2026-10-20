import { useId, useState } from 'react'
import type { WorkspaceShell } from '../../core/workspace-store'
import Modal from './Modal'
import { workspaceStore } from './store'

/**
 * New shell, or editing one: its name, an optional command typed each time it starts (e.g.
 * `npm run dev`), whether it starts when the workspace is first opened, and whether it closes
 * once that command ends on its own (typed as `<command>; exit`, so a Ctrl+C keeps the prompt). No worktree: shells
 * run in the workspace's folder.
 */
function ShellDialog({
  workspaceId,
  shell,
  onDone
}: {
  workspaceId: string
  /** The shell being edited; null for a new one. */
  shell: WorkspaceShell | null
  onDone: () => void
}): React.JSX.Element {
  const id = useId()
  const [name, setName] = useState(shell?.name ?? '')
  const [command, setCommand] = useState(shell?.command ?? '')
  const [autostart, setAutostart] = useState(shell?.autostart ?? false)
  const [autoClose, setAutoClose] = useState(shell?.autoClose ?? false)
  const hasCommand = command.trim() !== ''
  const [errors, setErrors] = useState<{ name?: string; command?: string }>({})

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const input = { name, command, autostart, autoClose: hasCommand && autoClose }
    const result = shell
      ? workspaceStore.updateShell(workspaceId, shell.id, input)
      : workspaceStore.createShell(workspaceId, input)
    if (result.ok) {
      onDone()
      return
    }
    setErrors(
      result.error.field === 'command'
        ? { command: result.error.message }
        : { name: result.error.message }
    )
  }

  return (
    <Modal title={shell ? 'Edit shell' : 'New shell'} onClose={onDone} testId="shell-dialog">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            data-testid="shell-name"
            value={name}
            placeholder="Dev server"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setErrors({ ...errors, name: undefined })
            }}
          />
          {errors.name && (
            <p
              className="field-error"
              id={`${id}-name-error`}
              role="alert"
              data-testid="shell-error-name"
            >
              {errors.name}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${id}-command`}>Startup command</label>
          <input
            id={`${id}-command`}
            className="new-card-command"
            data-testid="shell-command"
            value={command}
            placeholder="npm run dev (optional)"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors.command ? true : undefined}
            aria-describedby={errors.command ? `${id}-command-error` : undefined}
            onChange={(e) => {
              setCommand(e.target.value)
              setErrors({ ...errors, command: undefined })
            }}
          />
          {errors.command ? (
            <p
              className="field-error"
              id={`${id}-command-error`}
              role="alert"
              data-testid="shell-error-command"
            >
              {errors.command}
            </p>
          ) : (
            <p className="field-hint">
              Typed each time the shell starts. Leave empty for a plain shell.
            </p>
          )}
        </div>
        <label className="new-card-check shell-autostart">
          <input
            type="checkbox"
            data-testid="shell-autostart"
            checked={autostart}
            onChange={(e) => setAutostart(e.target.checked)}
          />
          Start when the workspace opens
        </label>
        <label className="new-card-check shell-autostart">
          <input
            type="checkbox"
            data-testid="shell-auto-close"
            checked={hasCommand && autoClose}
            disabled={!hasCommand}
            aria-describedby={`${id}-auto-close-hint`}
            onChange={(e) => setAutoClose(e.target.checked)}
          />
          Close when the command stops
        </label>
        <p className="field-hint shell-auto-close-hint" id={`${id}-auto-close-hint`}>
          {hasCommand
            ? 'The shell exits once the command ends; Ctrl+C keeps the prompt.'
            : 'Needs a startup command.'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="shell-cancel" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="shell-submit">
            {shell ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ShellDialog
