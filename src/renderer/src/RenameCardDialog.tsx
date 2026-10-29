import { useId, useState } from 'react'
import type { Card } from '../../core/workspace-store'
import Modal from './Modal'
import { workspaceStore } from './store'

/**
 * Rename card (its shortcut, Ghostty's prompt_surface_title, and the palette) for the open card,
 * which has no menu (#31 D1): Save renames it as the board's inline rename does, Cancel and Esc
 * change nothing. Nothing is typed into the running card.
 */
function RenameCardDialog({
  workspaceId,
  card,
  onClose
}: {
  workspaceId: string
  card: Card
  onClose: () => void
}): React.JSX.Element {
  const id = useId()
  const [title, setTitle] = useState(card.title)
  const [error, setError] = useState<string | null>(null)

  const save = (): void => {
    const renamed = workspaceStore.renameCard(workspaceId, card.id, title)
    if (renamed.ok) onClose()
    else setError(renamed.error.message)
  }

  return (
    <Modal
      title="Rename card"
      onClose={onClose}
      testId="rename-card-dialog"
      initialFocus='[data-testid="rename-card-input"]'
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`}
            data-testid="rename-card-input"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-title-err` : undefined}
            value={title}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setTitle(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <p
              className="field-error"
              id={`${id}-title-err`}
              role="alert"
              data-testid="rename-card-error"
            >
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="rename-card-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="rename-card-save">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default RenameCardDialog
