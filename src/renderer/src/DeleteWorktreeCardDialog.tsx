import { useEffect, useState } from 'react'
import type { Card } from '../../core/workspace-store'
import Modal from './Modal'

/**
 * Deleting a card that has its own worktree: keep the worktree (the card only), or remove it
 * too. Its branch is always kept, so committed work stays. Uncommitted changes are warned about,
 * and focus starts on keeping it; removing it then removes them with it.
 */
function DeleteWorktreeCardDialog({
  card,
  running,
  onDelete,
  onCancel
}: {
  card: Card & { worktree: NonNullable<Card['worktree']> }
  running: boolean
  onDelete: (removeWorktree: boolean, force: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  // Until git answers, removing waits: a removal asked for before would refuse uncommitted work.
  const [checking, setChecking] = useState(true)
  const [dirty, setDirty] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void window.bikube.worktree.dirty(card.worktree.path).then((d) => {
      if (!live) return
      setDirty(d)
      setChecking(false)
    })
    return () => {
      live = false
    }
  }, [card.worktree.path])

  return (
    <Modal
      title="Delete card"
      onClose={onCancel}
      testId="confirm-dialog"
      initialFocus='[data-testid="delete-keep-worktree"]'
    >
      <p className="modal-message">
        Delete &ldquo;{card.title}&rdquo;?
        {running && ' Its terminal is still running and will be stopped.'} It has its own worktree
        on <code>{card.worktree.branch}</code>; the branch is kept either way.
      </p>
      {dirty && (
        <p className="field-error" role="alert" data-testid="delete-worktree-dirty">
          The worktree has uncommitted changes. Deleting the worktree loses them.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" data-testid="confirm-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          data-testid="delete-keep-worktree"
          onClick={() => onDelete(false, false)}
        >
          Keep worktree
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-testid="delete-with-worktree"
          disabled={checking}
          onClick={() => onDelete(true, dirty === true)}
        >
          {checking ? 'Checking…' : 'Delete worktree too'}
        </button>
      </div>
    </Modal>
  )
}

export default DeleteWorktreeCardDialog
