import { SquareTerminal, Zap } from 'lucide-react'
import { useId, useState } from 'react'
import type { ShellType, WorkspaceShell } from '../../core/workspace-store'
import { SMALL_ICON } from './icons'
import Modal from './Modal'
import { workspaceStore } from './store'

/** Each type's choice and what it does, under the choice. */
const TYPES: { type: ShellType; label: string; icon: typeof Zap; hint: string }[] = [
  {
    type: 'shell',
    label: 'Shell',
    icon: SquareTerminal,
    hint: 'A click opens its terminal; the command, if any, is typed each time it starts.'
  },
  {
    type: 'trigger',
    label: 'Trigger',
    icon: Zap,
    hint: 'A click runs the command in the background, and it exits when the command ends, done or failed. Click it while it runs to open it.'
  }
]

/**
 * New shell, or editing one: its type (a shell opens; a trigger runs its command in the
 * background and exits when it ends), its name, its command (optional for a shell, e.g.
 * `npm run dev`), and whether it starts when the workspace is first opened.
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
  const [type, setType] = useState<ShellType>(shell?.type ?? 'shell')
  const [errors, setErrors] = useState<{ name?: string; command?: string }>({})

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const input = { name, command, autostart, type }
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
        <fieldset className="field shell-type">
          <legend>Type</legend>
          <div className="segmented">
            {TYPES.map(({ type: t, label, icon: Icon }) => (
              <label key={t} className="radio">
                <input
                  type="radio"
                  name={`${id}-type`}
                  value={t}
                  data-testid={`shell-type-${t}`}
                  checked={type === t}
                  onChange={() => {
                    setType(t)
                    setErrors({ ...errors, command: undefined })
                  }}
                />
                <Icon {...SMALL_ICON} />
                {label}
              </label>
            ))}
          </div>
          <p className="field-hint" data-testid="shell-type-hint">
            {TYPES.find((t) => t.type === type)?.hint}
          </p>
        </fieldset>
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
          <label htmlFor={`${id}-command`}>Command</label>
          <input
            id={`${id}-command`}
            className="new-card-command"
            data-testid="shell-command"
            value={command}
            placeholder={type === 'trigger' ? 'npm run dev' : 'npm run dev (optional)'}
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
            type === 'shell' && <p className="field-hint">Leave empty for a plain shell.</p>
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
