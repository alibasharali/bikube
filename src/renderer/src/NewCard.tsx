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
import { StartupOptions } from './StartupField'
import { workspaceStore } from './store'

interface NewCardProps {
  workspaceId: string
  columnId: string
  /** The workspace's default startup command, the preset for the select (#5 D10). */
  defaultStartup: StartupCommand
  onCreated: (cardId: string) => void
}

/**
 * `+ New card` at the end of a column (#4 D4, #5 D9): an inline title with a startup command
 * select next to it, and a `Command` field below for Custom…. Enter in the title or command
 * creates the card at the bottom and opens it, which starts it (D3, D6, #5 D7). Esc cancels;
 * leaving the form cancels while the title is empty and the command is the default.
 */
function NewCard(props: NewCardProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  if (!adding) {
    return (
      <button
        type="button"
        className="new-card"
        data-testid="new-card"
        onClick={() => setAdding(true)}
      >
        + New card
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

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const submit = (): void => {
    const created = workspaceStore.createCard(workspaceId, columnId, title, draftStartup(draft))
    if (created.ok) {
      onCreated(created.value.id)
      onDone()
    } else if (created.error.field === 'command') {
      setCommandError(created.error.message)
    } else {
      setTitleError(created.error.message)
    }
  }

  /** Enter submits from the text fields; Esc cancels from anywhere in the form. */
  const onKeyDown = (e: React.KeyboardEvent, submits: boolean): void => {
    const action = editKeyAction(e.key)
    if (!action || (action === 'submit' && !submits)) return
    e.preventDefault()
    e.stopPropagation()
    if (action === 'submit') submit()
    else onDone()
  }

  return (
    <div
      className="inline-edit new-card-form"
      data-testid="new-card-form"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        if (title.trim() === '' && sameDraft(draft, initial)) onDone()
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
          onKeyDown={(e) => onKeyDown(e, true)}
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
          onKeyDown={(e) => onKeyDown(e, false)}
        >
          <StartupOptions />
        </select>
      </div>
      {titleError && (
        <p className="field-error" id="new-card-input-err" role="alert" data-testid="card-error">
          {titleError}
        </p>
      )}
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
          onKeyDown={(e) => onKeyDown(e, true)}
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
