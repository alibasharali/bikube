import { useState } from 'react'
import { draftStartup, startupDraft, type StartupDraft } from '../../core/startup-form'
import type { Card } from '../../core/workspace-store'
import Modal from './Modal'
import StartupField from './StartupField'
import { workspaceStore } from './store'

/**
 * `Startup command…` from the card menu (#5 D11): changes only the setting. A running card
 * keeps running untouched; the new command runs at its next start.
 */
function StartupDialog({
  workspaceId,
  card,
  onClose
}: {
  workspaceId: string
  card: Card
  onClose: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<StartupDraft>(() => startupDraft(card.startup))
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const saved = workspaceStore.setCardStartup(workspaceId, card.id, draftStartup(draft))
    if (saved.ok) onClose()
    else setError(saved.error.message)
  }

  return (
    <Modal
      title="Startup command"
      onClose={onClose}
      testId="startup-dialog"
      initialFocus='[data-testid="startup-dialog-startup"]'
    >
      <form onSubmit={submit} noValidate>
        <StartupField
          draft={draft}
          onChange={(next) => {
            setDraft(next)
            setError(undefined)
          }}
          error={error}
          testIdPrefix="startup-dialog"
        />
        <p className="modal-hint">Used the next time this card starts.</p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            data-testid="startup-dialog-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="startup-dialog-save">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default StartupDialog
