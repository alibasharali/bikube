import { cardPill, type CardStatus } from '../../core/card-status'
import type { ClaudeUsage } from '../../core/claude-pricing'
import { hasUsage, usageLine, usageTooltip } from '../../core/usage-format'

/**
 * A card's lines under its title (#31 D11): the status row with its label and the activity pill
 * when set (D13), or the setup's pill in its place (#39 D5), then, while running,
 * the agent status (#9 D8) on up to 2 lines with its full text as tooltip and the last output
 * line in the terminal font, and last the Claude Code usage line (#50 D8) when it has usage,
 * running or not, its token breakdown as tooltip. The stop button (D10) sits beside the status
 * row, outside the card's open button (see `CardItem`). A card shown in its own window has the
 * `In window` chip on its status row (#53 D7).
 */
function CardLines({
  status,
  usage,
  inWindow = false
}: {
  status: CardStatus
  usage?: ClaudeUsage
  inWindow?: boolean
}): React.JSX.Element {
  const pill = cardPill(status)
  return (
    <>
      <span className="card-status" data-testid="card-status">
        <span className="card-status-label" data-testid="card-status-label">
          {status.label}
        </span>
        {pill?.kind === 'setup-running' || pill?.kind === 'setup-failed' ? (
          <span
            className={`card-activity card-activity-${pill.kind}`}
            data-testid="card-setup-pill"
            data-state={status.setup}
          >
            {pill.label}
          </span>
        ) : (
          pill && (
            <span
              className={`card-activity card-activity-${pill.kind}`}
              data-testid="card-activity"
              data-activity={pill.kind}
            >
              {pill.label}
            </span>
          )
        )}
        {inWindow && (
          <span className="card-in-window" data-testid="card-in-window">
            In window
          </span>
        )}
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
      {hasUsage(usage) && (
        <span className="card-usage" data-testid="card-usage" title={usageTooltip(usage)}>
          {usageLine(usage)}
        </span>
      )}
    </>
  )
}

export default CardLines
