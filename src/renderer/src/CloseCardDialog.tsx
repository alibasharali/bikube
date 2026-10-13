import { cardCloseConfirmation } from '../../core/card-deletes'
import ConfirmDialog from './ConfirmDialog'
import { closeCard } from './card-actions'

interface CloseCardDialogProps {
  cardId: string
  title: string
  onDone: () => void
}

/**
 * Asks before closing a running card (#7 D4); `Close` stops its process, `Cancel` or Esc
 * changes nothing. Either way `onDone` hides the dialog.
 */
function CloseCardDialog({ cardId, title, onDone }: CloseCardDialogProps): React.JSX.Element {
  return (
    <ConfirmDialog
      title="Close card"
      message={cardCloseConfirmation(title)}
      confirmLabel="Close"
      confirmTestId="confirm-close"
      onCancel={onDone}
      onConfirm={() => {
        onDone()
        closeCard(cardId)
      }}
    />
  )
}

export default CloseCardDialog
