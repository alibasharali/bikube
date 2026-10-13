import type { CardStatus } from '../../core/card-status'

/** `Running · <last output line>`, on one line (#4 D9). */
function CardStatusLine({
  status,
  className
}: {
  status: CardStatus | undefined
  className?: string
}): React.JSX.Element | null {
  if (!status) return null
  return (
    <p className={className ? `card-status ${className}` : 'card-status'} data-testid="card-status">
      <span className="card-status-label" data-testid="card-status-label">
        {status.label}
      </span>
      {status.lastLine && (
        <>
          <span className="card-status-sep" aria-hidden="true">
            {' · '}
          </span>
          <span className="card-status-line" data-testid="card-status-line">
            {status.lastLine}
          </span>
        </>
      )}
    </p>
  )
}

export default CardStatusLine
