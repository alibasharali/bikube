import { useId } from 'react'
import {
  DESCRIPTION_COUNTER_FROM,
  MAX_DESCRIPTION_LENGTH,
  descriptionLength
} from '../../core/card-description'

const MAX_LABEL = MAX_DESCRIPTION_LENGTH.toLocaleString('en-US')

/**
 * A card's Description field (#69 D3, D4): multi-line plain text, never rendered as markdown.
 * Past 90,000 characters a counter shows its length against the cap; a longer one is refused on
 * save, never cut, so the field takes it whole.
 */
function DescriptionField({
  value,
  onChange,
  error,
  testId,
  onKeyDown
}: {
  value: string
  onChange: (value: string) => void
  /** The store's refusal, e.g. over the cap. */
  error?: string | null
  /** The textarea's test id; the counter is `<testId>-count`, the error `<testId>-error`. */
  testId: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}): React.JSX.Element {
  const id = useId()
  const length = value.length > DESCRIPTION_COUNTER_FROM ? descriptionLength(value) : 0
  const counted = length > DESCRIPTION_COUNTER_FROM
  const over = length > MAX_DESCRIPTION_LENGTH
  const describedBy =
    [error ? `${id}-error` : '', counted ? `${id}-count` : ''].filter(Boolean).join(' ') ||
    undefined
  return (
    <div className="field">
      <label htmlFor={id}>Description</label>
      <textarea
        id={id}
        className="description-input"
        data-testid={testId}
        rows={6}
        placeholder="Markdown, optional"
        value={value}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {counted && (
        <p
          className={over ? 'field-error' : 'field-hint'}
          id={`${id}-count`}
          data-testid={`${testId}-count`}
        >
          {`${length.toLocaleString('en-US')} / ${MAX_LABEL}`}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}

export default DescriptionField
