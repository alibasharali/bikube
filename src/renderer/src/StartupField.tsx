import { useId } from 'react'
import {
  STARTUP_CHOICES,
  parseChoice,
  presetHint,
  type StartupDraft
} from '../../core/startup-form'

/** The startup commands, in the order every select shows them (#5 D9, #21 D5). */
export function StartupOptions(): React.JSX.Element {
  return (
    <>
      {STARTUP_CHOICES.map(({ choice, label }) => (
        <option key={choice} value={choice}>
          {label}
        </option>
      ))}
    </>
  )
}

interface StartupFieldProps {
  draft: StartupDraft
  onChange: (draft: StartupDraft) => void
  /** The Command field's error, e.g. `Command is required`. */
  error?: string
  /** Test id prefix: `<prefix>-startup`, `<prefix>-command`, `<prefix>-error-command`. */
  testIdPrefix: string
}

/**
 * The `Startup command` field of a dialog (#5 D10, D11; #21 D4): a select with every startup
 * command, a `Command` field below while Custom… is chosen, and a hint while a preset is.
 */
function StartupField({
  draft,
  onChange,
  error,
  testIdPrefix
}: StartupFieldProps): React.JSX.Element {
  const id = useId()
  const selectId = `${id}-startup`
  const commandId = `${id}-command`
  const errorId = `${id}-command-error`
  const hintId = `${id}-hint`
  const hint = presetHint(draft.choice)
  return (
    <>
      <div className="field">
        <label htmlFor={selectId}>Startup command</label>
        <select
          id={selectId}
          data-testid={`${testIdPrefix}-startup`}
          value={draft.choice}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange({ ...draft, choice: parseChoice(e.target.value) })}
        >
          <StartupOptions />
        </select>
        {hint && (
          <p className="field-hint" id={hintId} data-testid={`${testIdPrefix}-startup-hint`}>
            {hint}
          </p>
        )}
      </div>
      {draft.choice === 'custom' && (
        <div className="field">
          <label htmlFor={commandId}>Command</label>
          <input
            id={commandId}
            data-testid={`${testIdPrefix}-command`}
            value={draft.command}
            placeholder="npm run dev"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange({ ...draft, command: e.target.value })}
          />
          {error && (
            <p
              className="field-error"
              id={errorId}
              role="alert"
              data-testid={`${testIdPrefix}-error-command`}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </>
  )
}

export default StartupField
