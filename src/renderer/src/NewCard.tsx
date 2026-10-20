import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { editKeyAction } from '../../core/inline-edit'
import type { StartupCommand } from '../../core/startup-command'
import {
  draftStartup,
  parseChoice,
  sameDraft,
  startupDraft,
  type StartupDraft
} from '../../core/startup-form'
import { ICON } from './icons'
import { StartupOptions } from './StartupField'
import { workspaceStore } from './store'
import { branchProblem, suggestBranch } from '../../core/worktree-names'
import type { NewCardWorktree } from '../../core/workspace-store'
import type { WorktreeInfo } from '../../shared/api'

interface NewCardProps {
  workspaceId: string
  columnId: string
  /** The workspace's default startup command, the preset for the select (#5 D10). */
  defaultStartup: StartupCommand
  onCreated: (cardId: string) => void
  /** A request to open the form (the command palette's New card, #40 D9): each new id opens it. */
  openRequest?: number
}

/**
 * `+ New card` at the end of a column (#4 D4, #5 D9): an inline title with a startup command
 * select next to it, and a `Command` field below for Custom…. Enter in the title, the select or the
 * command creates the card at the bottom and opens it, which starts it (D3, D6, #5 D7). Esc cancels;
 * leaving the form cancels while the title is empty and the command is the default.
 */
function NewCard(props: NewCardProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [openedFor, setOpenedFor] = useState<number | undefined>(undefined)
  if (props.openRequest !== undefined && props.openRequest !== openedFor) {
    setOpenedFor(props.openRequest)
    setAdding(true)
  }
  if (!adding) {
    return (
      <button
        type="button"
        className="new-card"
        data-testid="new-card"
        onClick={() => setAdding(true)}
      >
        <Plus {...ICON} />
        New card
      </button>
    )
  }
  return <NewCardForm {...props} onDone={() => setAdding(false)} />
}

function NewCardForm({
  workspaceId,
  columnId,
  defaultStartup,
  onCreated,
  onDone
}: NewCardProps & { onDone: () => void }): React.JSX.Element {
  const [initial] = useState(() => startupDraft(defaultStartup))
  const [draft, setDraft] = useState<StartupDraft>(initial)
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)

  // A local workspace in a git repository offers the card its own worktree.
  const [repo, setRepo] = useState<WorktreeInfo | null>(null)
  const [ownWorktree, setOwnWorktree] = useState(false)
  // The branch follows the title until it is edited.
  const [typedBranch, setTypedBranch] = useState<string | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const cardTitle = title.trim() || `Terminal ${workspace?.nextCardNumber ?? 1}`
  const branch = typedBranch ?? suggestBranch(cardTitle, new Set(repo?.branches ?? []))

  useEffect(() => {
    titleRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!workspace || workspace.host !== undefined) return
    let live = true
    void window.drovr.worktree.info(workspace.directory).then((info) => live && setRepo(info))
    return () => {
      live = false
    }
    // The workspace's folder is fixed while the form is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  /** Makes the card's worktree first, when asked for; the card is only created once it exists. */
  const submit = (): void => {
    if (creating) return
    if (!ownWorktree || !repo || !workspace) {
      create()
      return
    }
    const problem = branchProblem(branch)
    if (problem) {
      setBranchError(problem)
      return
    }
    setCreating(true)
    void window.drovr.worktree.create(workspace.directory, branch).then((made) => {
      setCreating(false)
      if (!made.ok) {
        setBranchError(made.reason)
        return
      }
      create({
        directory: made.directory,
        worktree: { path: made.path, branch: made.branch, repo: workspace.directory }
      })
    })
  }

  const create = (worktree?: NewCardWorktree): void => {
    const created = workspaceStore.createCard(
      workspaceId,
      columnId,
      title,
      draftStartup(draft),
      worktree
    )
    if (created.ok) {
      onCreated(created.value.id)
      onDone()
    } else if (created.error.field === 'command') {
      setCommandError(created.error.message)
    } else {
      setTitleError(created.error.message)
    }
  }

  /** Enter submits and Esc cancels from anywhere in the form. */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const action = editKeyAction(e.key)
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    if (action === 'submit') submit()
    else onDone()
  }

  return (
    <div
      className="inline-edit new-card-form"
      data-testid="new-card-form"
      // A press on the form's text (the Own worktree label) keeps the focus where it is, so it
      // never counts as leaving the form; the label's click still toggles its checkbox.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input, select, button, textarea'))
          e.preventDefault()
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        if (title.trim() === '' && sameDraft(draft, initial) && !ownWorktree && !creating) onDone()
      }}
    >
      <div className="inline-edit-row">
        <input
          ref={titleRef}
          className="inline-input"
          data-testid="new-card-input"
          aria-label="Card title"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'new-card-input-err' : undefined}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setTitleError(null)
          }}
          onKeyDown={onKeyDown}
        />
        <select
          className="inline-select"
          data-testid="new-card-startup"
          aria-label="Startup command"
          value={draft.choice}
          onChange={(e) => {
            setDraft({ ...draft, choice: parseChoice(e.target.value) })
            setCommandError(null)
          }}
          // An open dropdown takes Enter to pick; once picked, Enter here creates the card.
          onKeyDown={onKeyDown}
        >
          <StartupOptions remote={workspace?.host !== undefined} />
        </select>
      </div>
      {titleError && (
        <p className="field-error" id="new-card-input-err" role="alert" data-testid="card-error">
          {titleError}
        </p>
      )}
      {repo && (
        <div className="new-card-worktree">
          <label className="new-card-check">
            <input
              type="checkbox"
              data-testid="new-card-worktree"
              checked={ownWorktree}
              disabled={creating}
              onChange={(e) => {
                setOwnWorktree(e.target.checked)
                setBranchError(null)
              }}
              onKeyDown={onKeyDown}
            />
            Own worktree
          </label>
          {ownWorktree && (
            <input
              className="inline-input new-card-branch"
              data-testid="new-card-branch"
              aria-label="Branch"
              value={branch}
              disabled={creating}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={branchError ? true : undefined}
              aria-describedby={branchError ? 'new-card-branch-err' : undefined}
              onChange={(e) => {
                setTypedBranch(e.target.value)
                setBranchError(null)
              }}
              onKeyDown={onKeyDown}
            />
          )}
          {ownWorktree && !branchError && (
            <p className="field-hint" data-testid="new-card-worktree-hint">
              {creating
                ? 'Creating worktree…'
                : `A new branch from ${repo.branch ?? 'HEAD'}, with ignored files copied.${
                    // The workspace's setup runs before the agent starts (#39 D9).
                    workspace?.worktreeSetup ? ` Runs ${workspace.worktreeSetup} first.` : ''
                  }`}
            </p>
          )}
          {branchError && (
            <p
              className="field-error"
              id="new-card-branch-err"
              role="alert"
              data-testid="new-card-error-branch"
            >
              {branchError}
            </p>
          )}
        </div>
      )}{' '}
      {draft.choice === 'custom' && (
        <input
          className="inline-input new-card-command"
          data-testid="new-card-command"
          aria-label="Command"
          placeholder="Command"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={commandError ? true : undefined}
          aria-describedby={commandError ? 'new-card-command-err' : undefined}
          value={draft.command}
          onChange={(e) => {
            setDraft({ ...draft, command: e.target.value })
            setCommandError(null)
          }}
          onKeyDown={onKeyDown}
        />
      )}
      {commandError && (
        <p
          className="field-error"
          id="new-card-command-err"
          role="alert"
          data-testid="new-card-error-command"
        >
          {commandError}
        </p>
      )}
    </div>
  )
}

export default NewCard
