import { useState } from 'react'
import { cardCloseConfirmation } from '../../core/card-deletes'
import ConfirmDialog from './ConfirmDialog'
import { closeCard } from './card-actions'
import { settingsStore } from './settings'

interface CloseCardDialogProps {
  cardId: string
  title: string
  onDone: () => void
}

/**
 * Asks before closing a running card (#7 D4); `Close` stops its process, `Cancel` or Esc
 * changes nothing. Either way `onDone` hides the dialog. Don't ask again, checked when closing,
 * turns the confirmation off (Settings turns it back on).
 */
function CloseCardDialog({ cardId, title, onDone }: CloseCardDialogProps): React.JSX.Element {
  const [dontAsk, setDontAsk] = useState(false)
  return (
    <ConfirmDialog
      title="Close card"
      message={cardCloseConfirmation(title)}
      confirmLabel="Close"
      confirmTestId="confirm-close"
      onCancel={onDone}
      onConfirm={() => {
        onDone()
        if (dontAsk) settingsStore.update({ confirmClose: false })
        closeCard(cardId)
      }}
    >
      <label className="new-card-check confirm-dont-ask">
        <input
          type="checkbox"
          data-testid="confirm-dont-ask"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
        />
        Don&apos;t ask again
      </label>
    </ConfirmDialog>
  )
}

export default CloseCardDialog
