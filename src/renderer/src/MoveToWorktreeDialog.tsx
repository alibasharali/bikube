import { useEffect, useId, useState } from 'react'
import { branchProblem, suggestBranch } from '../../core/worktree-names'
import type { Card } from '../../core/workspace-store'
import type { WorktreeInfo } from '../../shared/api'
import { cardTerminals } from './card-terminals'
import Modal from './Modal'
import { workspaceStore } from './store'

/**
 * Move to own worktree: a stopped local card without a worktree gets a new one on a new branch,
 * named from its title as a new card's is, and runs there from its next start. Its agent starts
 * a new conversation there, since agents keep theirs per folder.
 */
function MoveToWorktreeDialog({
  workspaceId,
  card,
  onDone
}: {
  workspaceId: string
  card: Card
  onDone: () => void
}): React.JSX.Element {
  const id = useId()
  const [repo, setRepo] = useState<WorktreeInfo | null | undefined>(undefined)
  const [typed, setTyped] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const branch = typed ?? (repo ? suggestBranch(card.title, new Set(repo.branches)) : '')
  const setup = workspaceStore
    .getState()
    .workspaces.find((w) => w.id === workspaceId)?.worktreeSetup
  const agentStarted = card.claudeStarted || card.startedAgents.length > 0

  useEffect(() => {
    let live = true
    void window.drovr.worktree.info(card.directory).then((info) => live && setRepo(info))
    return () => {
      live = false
    }
  }, [card.directory])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (creating || !repo) return
    const problem = branchProblem(branch)
    if (problem) {
      setError(problem)
      return
    }
    setCreating(true)
    void window.drovr.worktree.create(card.directory, branch).then(async (made) => {
      if (!made.ok) {
        setCreating(false)
        setError(made.reason)
        return
      }
      // Started while git made the worktree: it keeps running where it is.
      if (cardTerminals().runState(card.id)?.kind === 'running') {
        await window.drovr.worktree.remove(card.directory, made.path, false)
        setCreating(false)
        setError('The card started; close it first')
        return
      }
      const moved = workspaceStore.moveCardToWorktree(workspaceId, card.id, {
        directory: made.directory,
        worktree: { path: made.path, branch: made.branch, repo: card.directory }
      })
      if (!moved.ok) {
        await window.drovr.worktree.remove(card.directory, made.path, false)
        setCreating(false)
        setError(moved.error.message)
        return
      }
      onDone()
    })
  }

  return (
    <Modal title="Move to own worktree" onClose={onDone} testId="move-worktree-dialog">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${id}-branch`}>Branch</label>
          <input
            id={`${id}-branch`}
            className="new-card-command"
            data-testid="move-worktree-branch"
            value={branch}
            disabled={!repo || creating}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setTyped(e.target.value)
              setError(null)
            }}
          />
          {error ? (
            <p
              className="field-error"
              id={`${id}-hint`}
              role="alert"
              data-testid="move-worktree-error"
            >
              {error}
            </p>
          ) : (
            <p className="field-hint" id={`${id}-hint`} data-testid="move-worktree-hint">
              {repo === undefined
                ? 'Reading the repository…'
                : repo === null
                  ? 'The card’s folder isn’t in a git repository.'
                  : `A new branch from ${repo.branch ?? 'HEAD'}, with ignored files copied. ` +
                    `The card runs there from its next start${setup ? `, after ${setup}` : ''}.` +
                    (agentStarted ? ' Its agent starts a new conversation there.' : '')}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="move-worktree-cancel" onClick={onDone}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="move-worktree-submit"
            disabled={!repo || creating}
          >
            {creating ? 'Creating worktree…' : 'Move'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default MoveToWorktreeDialog
