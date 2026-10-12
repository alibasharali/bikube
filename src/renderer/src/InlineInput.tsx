import { useEffect, useRef, useState } from 'react'
import { editKeyAction, startEdit, submitEdit, typeInto } from '../../core/inline-edit'
import type { Result } from '../../core/workspace-store'

interface InlineInputProps {
  initial: string
  label: string
  inputTestId: string
  errorTestId: string
  /** Validates and applies the value; a rejection keeps the input open with the message. */
  onCommit: (value: string) => Result<unknown>
  onDone: () => void
  /** Optional trailing controls (e.g. an explicit submit button). */
  children?: React.ReactNode
  className?: string
}

/** Text input with inline error: Enter submits, Esc cancels (AC9). Blur cancels too. */
function InlineInput({
  initial,
  label,
  inputTestId,
  errorTestId,
  onCommit,
  onDone,
  children,
  className
}: InlineInputProps): React.JSX.Element {
  const [edit, setEdit] = useState(() => startEdit(initial))
  const ref = useRef<HTMLInputElement>(null)
  const errorId = `${inputTestId}-err`

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const submit = (): void => {
    const outcome = submitEdit(edit, onCommit)
    if (outcome.done) onDone()
    else setEdit(outcome.edit)
  }

  return (
    <div
      className={className ? `inline-edit ${className}` : 'inline-edit'}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onDone()
      }}
    >
      <div className="inline-edit-row">
        <input
          ref={ref}
          className="inline-input"
          data-testid={inputTestId}
          aria-label={label}
          aria-invalid={edit.error ? true : undefined}
          aria-describedby={edit.error ? errorId : undefined}
          value={edit.value}
          onChange={(e) => setEdit(typeInto(edit, e.target.value))}
          onKeyDown={(e) => {
            const action = editKeyAction(e.key)
            if (!action) return
            e.preventDefault()
            e.stopPropagation()
            if (action === 'submit') submit()
            else onDone()
          }}
        />
        {children && (
          <button
            type="button"
            className="btn btn-primary btn-small"
            data-testid="add-column-submit"
            onClick={submit}
          >
            {children}
          </button>
        )}
      </div>
      {edit.error && (
        <p className="field-error" id={errorId} role="alert" data-testid={errorTestId}>
          {edit.error}
        </p>
      )}
    </div>
  )
}

export default InlineInput
