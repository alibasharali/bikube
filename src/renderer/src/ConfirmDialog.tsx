import Modal from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Destructive confirmation. Focus starts on Cancel so a stray Enter cannot delete. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
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
          data-testid="confirm-delete"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export default ConfirmDialog
