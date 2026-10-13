import { useId } from 'react'
import { parseChoice, type StartupDraft } from '../../core/startup-form'

/** The three startup commands, in the order every select shows them (#5 D9). */
export function StartupOptions(): React.JSX.Element {
  return (
    <>
      <option value="shell">Shell</option>
      <option value="claude">Claude Code</option>
      <option value="custom">Custom…</option>
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
 * The `Startup command` field of a dialog (#5 D10, D11): a select with Shell, Claude Code and
 * Custom…, and a `Command` field below while Custom… is chosen.
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
  return (
    <>
      <div className="field">
        <label htmlFor={selectId}>Startup command</label>
        <select
          id={selectId}
          data-testid={`${testIdPrefix}-startup`}
          value={draft.choice}
          onChange={(e) => onChange({ ...draft, choice: parseChoice(e.target.value) })}
        >
          <StartupOptions />
        </select>
      </div>
      {draft.choice === 'custom' && (
        <div className="field">
          <label htmlFor={commandId}>Command</label>
          <input
            id={commandId}
            data-testid={`${testIdPrefix}-command`}
            value={draft.command}
            placeholder="codex resume --last"
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
