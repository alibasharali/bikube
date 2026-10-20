import { AppWindow, BellDot, MessageCircleQuestion, SquareTerminal, StickyNote } from 'lucide-react'
import { ACTIVITY_LABELS } from '../../core/activity'
import type { OpenTerminal } from '../../core/open-terminals'
import { useInWindow } from './card-windows'
import { SMALL_ICON } from './icons'

interface WorkspaceTerminalsProps {
  terminals: readonly OpenTerminal[]
  /** The card or shell open at full size in the active workspace, or null. */
  currentId: string | null
  onOpen: (workspaceId: string, cardId: string) => void
}

/**
 * A workspace's running cards and shells, nested under its sidebar row, each opened as a palette
 * pick opens it (switching workspace, or focusing its own window). A card waiting for the user
 * or asking a question shows it here, on the card itself.
 */
function WorkspaceTerminals({
  terminals,
  currentId,
  onOpen
}: WorkspaceTerminalsProps): React.JSX.Element | null {
  if (terminals.length === 0) return null
  return (
    <ul className="workspace-terminals" data-testid="workspace-terminals">
      {terminals.map((row) => (
        <TerminalRow
          key={row.cardId}
          row={row}
          current={row.cardId === currentId}
          onOpen={onOpen}
        />
      ))}
    </ul>
  )
}

function TerminalRow({
  row,
  current,
  onOpen
}: {
  row: OpenTerminal
  current: boolean
  onOpen: WorkspaceTerminalsProps['onOpen']
}): React.JSX.Element {
  const inWindow = useInWindow(row.cardId)
  const Kind = row.kind === 'shell' ? SquareTerminal : StickyNote
  const needsYou = row.activity === 'waiting' || row.activity === 'question'
  const classes = ['workspace-terminal']
  if (current) classes.push('active')
  if (needsYou) classes.push('needs-you')
  return (
    <li>
      <button
        type="button"
        className={classes.join(' ')}
        data-testid="workspace-terminal"
        data-kind={row.kind}
        aria-current={current ? 'true' : undefined}
        title={row.kind === 'shell' ? `${row.title} (shell)` : row.title}
        onClick={() => onOpen(row.workspaceId, row.cardId)}
      >
        <Kind className="workspace-terminal-kind" {...SMALL_ICON} />
        <span className="workspace-terminal-title" data-testid="workspace-terminal-title">
          {row.title}
        </span>
        {inWindow && (
          <span
            className="workspace-terminal-window"
            data-testid="workspace-terminal-in-window"
            title="In its own window"
            aria-label="In its own window"
          >
            <AppWindow {...SMALL_ICON} />
          </span>
        )}
        {row.activity && <ActivityMark activity={row.activity} />}
      </button>
    </li>
  )
}

/** Working as a dot; Waiting for you and Needs your answer as an amber icon, named by tooltip. */
function ActivityMark({
  activity
}: {
  activity: NonNullable<OpenTerminal['activity']>
}): React.JSX.Element {
  const label = ACTIVITY_LABELS[activity]
  const Icon =
    activity === 'waiting' ? BellDot : activity === 'question' ? MessageCircleQuestion : null
  return (
    <span
      className={`workspace-terminal-activity workspace-terminal-${activity}`}
      data-testid="workspace-terminal-activity"
      data-activity={activity}
      title={label}
      aria-label={label}
    >
      {Icon && <Icon {...SMALL_ICON} />}
    </span>
  )
}

export default WorkspaceTerminals
