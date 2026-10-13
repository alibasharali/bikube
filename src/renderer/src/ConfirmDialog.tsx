import Modal from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  /** The confirm button's test id; deletes keep the default. */
  confirmTestId?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Destructive confirmation. Focus starts on Cancel so a stray Enter cannot delete or close. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmTestId = 'confirm-delete',
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      testId="confirm-dialog"
      initialFocus='[data-testid="confirm-cancel"]'
    >
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn" data-testid="confirm-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-testid={confirmTestId}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export default ConfirmDialog
