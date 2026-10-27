import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { checkDescription } from '../../core/card-description'
import { dialogEnterAction, dialogKeyTarget } from '../../core/dialog-keys'
import type { StartupCommand } from '../../core/startup-command'
import { draftStartup, startupDraft, type StartupDraft } from '../../core/startup-form'
import { branchProblem, suggestBranch } from '../../core/worktree-names'
import type { NewCardWorktree } from '../../core/workspace-store'
import type { WorktreeInfo } from '../../shared/api'
import DescriptionField from './DescriptionField'
import { ICON } from './icons'
import Modal from './Modal'
import StartupField from './StartupField'
import { workspaceStore } from './store'

interface NewCardProps {
  workspaceId: string
  columnId: string
  /** The column's name, which the dialog says it adds to (#69 D3). */
  columnName: string
  /** The workspace's default startup command, the preset for the select (#5 D10). */
  defaultStartup: StartupCommand
  onCreated: (cardId: string) => void
  /** A request to open the dialog (the command palette's New card, #40 D9): each new id opens it. */
  openRequest?: number
}

/**
 * `+ New card` at the end of a column or in the grid (#4 D4, #5 D9): opens the New card dialog
 * (#69 D3), which creates the card at the bottom of the column and opens it, which starts it.
 */
function NewCard(props: NewCardProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [openedFor, setOpenedFor] = useState<number | undefined>(undefined)
  if (props.openRequest !== undefined && props.openRequest !== openedFor) {
    setOpenedFor(props.openRequest)
    setAdding(true)
  }
  return (
    <>
      <button
        type="button"
        className="new-card"
        data-testid="new-card"
        onClick={() => setAdding(true)}
      >
        <Plus {...ICON} />
        New card
      </button>
      {adding && <NewCardDialog {...props} onDone={() => setAdding(false)} />}
    </>
  )
}

/**
 * The New card dialog (#69 D3): Title (optional, `Terminal N` when empty), Description, Agent
 * (the startup select, on the workspace's default) and, for a local workspace in a git
 * repository, Own worktree with its branch, made by main before the card is created. Create,
 * Enter in a one-line field and Mod+Enter anywhere create it; Esc and Cancel create nothing.
 */
function NewCardDialog({
  workspaceId,
  columnId,
  columnName,
  defaultStartup,
  onCreated,
  onDone
}: NewCardProps & { onDone: () => void }): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState<StartupDraft>(() => startupDraft(defaultStartup))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | undefined>(undefined)
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  const remote = workspace?.host !== undefined

  // A local workspace in a git repository offers the card its own worktree.
  const [repo, setRepo] = useState<WorktreeInfo | null>(null)
  const [ownWorktree, setOwnWorktree] = useState(false)
  // The branch follows the title until it is edited.
  const [typedBranch, setTypedBranch] = useState<string | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const placeholder = `Terminal ${workspace?.nextCardNumber ?? 1}`
  const cardTitle = title.trim() || placeholder
  const branch = typedBranch ?? suggestBranch(cardTitle, new Set(repo?.branches ?? []))

  // Closed (Esc, Cancel) while main makes the worktree: nothing is created (#69 D3).
  const closed = useRef(false)
  useEffect(
    () => () => {
      closed.current = true
    },
    []
  )
  const close = (): void => {
    closed.current = true
    onDone()
  }

  useEffect(() => {
    if (!workspace || workspace.host !== undefined) return
    let live = true
    void window.bikube.worktree.info(workspace.directory).then((info) => live && setRepo(info))
    return () => {
      live = false
    }
    // The workspace's folder is fixed while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  /** Makes the card's worktree first, when asked for; the card is only created once it exists. */
  const submit = (): void => {
    if (creating) return
    if (!ownWorktree || !repo || !workspace) {
      create()
      return
    }
    // Checked before main makes the worktree, which a refused card would leave behind.
    const described = checkDescription(description)
    if (!described.ok) {
      setDescriptionError(described.error.message)
      return
    }
    const problem = branchProblem(branch)
    if (problem) {
      setBranchError(problem)
      return
    }
    setCreating(true)
    void window.bikube.worktree.create(workspace.directory, branch).then((made) => {
      if (closed.current) {
        // Its branch stays, as when a card can't move into a new worktree.
        if (made.ok) void window.bikube.worktree.remove(workspace.directory, made.path, false)
        return
      }
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
      worktree,
      description
    )
    if (created.ok) {
      onCreated(created.value.id)
      close()
    } else if (created.error.field === 'command') {
      setCommandError(created.error.message)
    } else if (created.error.field === 'description') {
      setDescriptionError(created.error.message)
    } else {
      setTitleError(created.error.message)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const action = dialogEnterAction(
      {
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        target: dialogKeyTarget(e.target)
      },
      window.bikube.platform
    )
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    submit()
  }

  return (
    <Modal
      title="New card"
      onClose={close}
      testId="new-card-dialog"
      initialFocus='[data-testid="new-card-input"]'
    >
      <form
        data-testid="new-card-form"
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="modal-hint new-card-column" data-testid="new-card-column">
          Add to <strong>{columnName}</strong>
        </p>
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input
            id={`${id}-title`}
            data-testid="new-card-input"
            placeholder={placeholder}
            autoComplete="off"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? `${id}-title-err` : undefined}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleError(null)
            }}
          />
          {titleError && (
            <p className="field-error" id={`${id}-title-err`} role="alert" data-testid="card-error">
              {titleError}
            </p>
          )}
        </div>
        <DescriptionField
          value={description}
          onChange={(value) => {
            setDescription(value)
            setDescriptionError(null)
          }}
          error={descriptionError}
          testId="new-card-description"
        />
        <StartupField
          draft={draft}
          onChange={(next) => {
            setDraft(next)
            setCommandError(undefined)
          }}
          error={commandError}
          testIdPrefix="new-card"
          remote={remote}
          label="Agent"
        />
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
              />
              Own worktree
            </label>
            {ownWorktree && (
              <div className="field new-card-branch-field">
                <label htmlFor={`${id}-branch`}>Branch</label>
                <input
                  id={`${id}-branch`}
                  className="new-card-branch"
                  data-testid="new-card-branch"
                  value={branch}
                  disabled={creating}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={branchError ? true : undefined}
                  aria-describedby={`${id}-branch-hint`}
                  onChange={(e) => {
                    setTypedBranch(e.target.value)
                    setBranchError(null)
                  }}
                />
                {branchError ? (
                  <p
                    className="field-error"
                    id={`${id}-branch-hint`}
                    role="alert"
                    data-testid="new-card-error-branch"
                  >
                    {branchError}
                  </p>
                ) : (
                  <p
                    className="field-hint"
                    id={`${id}-branch-hint`}
                    data-testid="new-card-worktree-hint"
                  >
                    {creating
                      ? 'Creating worktree…'
                      : `A new branch from ${repo.branch ?? 'HEAD'}, with ignored files copied.${
                          // The workspace's setup runs before the agent starts (#39 D9).
                          workspace?.worktreeSetup ? ` Runs ${workspace.worktreeSetup} first.` : ''
                        }`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="new-card-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="new-card-create"
            disabled={creating}
          >
            {creating ? 'Creating worktree…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default NewCard
