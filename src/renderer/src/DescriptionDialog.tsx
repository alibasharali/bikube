import { useState } from 'react'
import { dialogEnterAction, dialogKeyTarget } from '../../core/dialog-keys'
import type { Card } from '../../core/workspace-store'
import DescriptionField from './DescriptionField'
import Modal from './Modal'
import { workspaceStore } from './store'

/**
 * `Edit description…` from the card menu (#69 D4): Save stores the text (empty removes it),
 * Cancel and Esc change nothing. Only the setting changes: nothing is typed into a running card.
 */
function DescriptionDialog({
  workspaceId,
  card,
  onClose
}: {
  workspaceId: string
  card: Card
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState(card.description ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = (): void => {
    const saved = workspaceStore.setCardDescription(workspaceId, card.id, text)
    if (saved.ok) onClose()
    else setError(saved.error.message)
  }

  return (
    <Modal
      title="Edit description"
      onClose={onClose}
      testId="description-dialog"
      initialFocus='[data-testid="description-dialog-input"]'
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => {
          const action = dialogEnterAction(
            {
              key: e.key,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              altKey: e.altKey,
              shiftKey: e.shiftKey,
              isComposing: e.nativeEvent.isComposing,
              target: dialogKeyTarget(e.target)
            },
            window.bikube.platform
          )
          if (!action) return
          e.preventDefault()
          e.stopPropagation()
          save()
        }}
      >
        <p className="modal-hint new-card-column">{card.title}</p>
        <DescriptionField
          value={text}
          onChange={(value) => {
            setText(value)
            setError(null)
          }}
          error={error}
          testId="description-dialog-input"
        />
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            data-testid="description-dialog-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="description-dialog-save">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default DescriptionDialog
