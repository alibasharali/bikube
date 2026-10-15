import type { CardStatus } from '../../core/card-status'

/**
 * A card's lines under its title (#31 D11): the status row with its label, then, while running,
 * the agent status (#9 D8) on up to 2 lines with its full text as tooltip and the last output
 * line in the terminal font. The stop button (D10) sits beside the status row, outside the
 * card's open button (see `CardItem`).
 */
function CardLines({ status }: { status: CardStatus }): React.JSX.Element {
  return (
    <>
      <span className="card-status" data-testid="card-status">
        <span className="card-status-label" data-testid="card-status-label">
          {status.label}
        </span>
        {/* The activity pill (#31 D13) goes here. */}
      </span>
      {status.agentStatus && (
        <span
          className="card-agent-status"
          data-testid="card-agent-status"
          title={status.agentStatus}
        >
          {status.agentStatus}
        </span>
      )}
      {status.lastLine && (
        <span className="card-status-line" data-testid="card-status-line">
          {status.lastLine}
        </span>
      )}
    </>
  )
}

export default CardLines
