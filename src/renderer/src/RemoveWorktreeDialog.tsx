import { useEffect, useState } from 'react'
import type { Card, CardWorktree } from '../../core/workspace-store'
import { startCard } from './card-actions'
import { cardTerminals } from './card-terminals'
import Modal from './Modal'
import { workspaceStore } from './store'

/**
 * Remove worktree: a stopped worktree card loses its worktree folder (its branch is kept) and
 * runs in the workspace folder from its next start, on the branch checked out there, with a new
 * agent session. `gone` is the same for a card whose folder is already gone (its start found no
 * folder): git's stale entry is pruned and the card starts at once in the workspace folder.
 */
function RemoveWorktreeDialog({
  workspaceId,
  card,
  gone = false,
  onDone
}: {
  workspaceId: string
  card: Card & { worktree: CardWorktree }
  gone?: boolean
  onDone: () => void
}): React.JSX.Element {
  // Until git answers, removing waits: a removal asked for before would refuse uncommitted work.
  const [checking, setChecking] = useState(!gone)
  const [dirty, setDirty] = useState<boolean | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agentStarted = card.claudeStarted || card.startedAgents.length > 0
  const { path, repo, branch } = card.worktree

  useEffect(() => {
    if (gone) return
    let live = true
    void window.bikube.worktree.dirty(path).then((d) => {
      if (!live) return
      setDirty(d)
      setChecking(false)
    })
    return () => {
      live = false
    }
  }, [gone, path])

  const remove = (): void => {
    if (cardTerminals().runState(card.id)?.kind === 'running') {
      setError('The card started; close it first')
      return
    }
    setRemoving(true)
    void window.bikube.worktree.remove(repo, path, dirty === true).then((result) => {
      if (!result.ok) {
        setRemoving(false)
        setError(result.reason)
        return
      }
      const moved = workspaceStore.moveCardOutOfWorktree(workspaceId, card.id)
      if (!moved.ok) {
        setRemoving(false)
        setError(moved.error.message)
        return
      }
      onDone()
      if (gone) startCard(workspaceId, card.id)
    })
  }

  return (
    <Modal
      title={gone ? 'Worktree folder gone' : 'Remove worktree'}
      onClose={onDone}
      testId="remove-worktree-dialog"
      initialFocus='[data-testid="remove-worktree-cancel"]'
    >
      <p className="modal-message">
        {gone ? (
          <>
            The worktree folder of &ldquo;{card.title}&rdquo; is gone. Run it in the workspace
            folder instead, on the branch checked out there?
          </>
        ) : (
          <>
            Remove the worktree of &ldquo;{card.title}&rdquo;? The card stays and runs in the
            workspace folder from its next start, on the branch checked out there.
          </>
        )}{' '}
        Its branch <code>{branch}</code> is kept.
        {agentStarted && ' Its agent starts a new conversation there.'}
      </p>
      {dirty && (
        <p className="field-error" role="alert" data-testid="remove-worktree-dirty">
          The worktree has uncommitted changes. Removing it loses them.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert" data-testid="remove-worktree-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" data-testid="remove-worktree-cancel" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className={gone ? 'btn btn-primary' : 'btn btn-danger'}
          data-testid="remove-worktree-submit"
          disabled={checking || removing}
          onClick={remove}
        >
          {checking
            ? 'Checking…'
            : removing
              ? 'Removing…'
              : gone
                ? 'Run in workspace folder'
                : 'Remove worktree'}
        </button>
      </div>
    </Modal>
  )
}

export default RemoveWorktreeDialog
