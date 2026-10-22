import { useEffect, useState } from 'react'
import type { CardWorktree } from '../../core/workspace-store'
import ConfirmDialog from './ConfirmDialog'

/** The branches a merge confirmation names (#38 D10). */
export interface MergeChoice {
  cardBranch: string
  branch: string
}

/**
 * Merge into the workspace branch's confirmation (#38 D10): what is merged into what, where, and,
 * when the card's worktree has uncommitted changes (untracked files too), that only its commits
 * are merged.
 */
function MergeCardDialog({
  worktree,
  choice,
  onMerge,
  onCancel
}: {
  worktree: CardWorktree
  choice: MergeChoice
  onMerge: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    let live = true
    void window.bikube.worktree.dirty(worktree.path).then((d) => {
      if (live) setDirty(d === true)
    })
    return () => {
      live = false
    }
  }, [worktree.path])
  return (
    <ConfirmDialog
      title="Merge branch"
      message={`Merge ${choice.cardBranch} into ${choice.branch} in ${worktree.repo}?`}
      detail={
        dirty
          ? "The card's uncommitted changes are not included: only its commits are merged."
          : undefined
      }
      confirmLabel="Merge"
      confirmTestId="confirm-merge"
      onConfirm={onMerge}
      onCancel={onCancel}
    />
  )
}

export default MergeCardDialog
