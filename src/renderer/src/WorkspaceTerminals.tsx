import { AppWindow, BellDot, LoaderCircle, MessageCircleQuestion } from 'lucide-react'
import { ACTIVITY_LABELS } from '../../core/activity'
import { AGENT_PRESETS, isAgentKind } from '../../core/agent-presets'
import type { OpenTerminal } from '../../core/open-terminals'
import { ToolIcon } from './AgentLogo'
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
 * pick opens it (switching workspace, or focusing its own window). Each shows what it runs: its
 * agent's logo, and its stretch of the tree's line, in the board tag's colour (`data-kind`). A
 * card waiting for the user or asking a question shows it here, on the card itself.
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
  const needsYou = row.activity === 'waiting' || row.activity === 'question'
  const classes = ['workspace-terminal']
  if (current) classes.push('active')
  if (needsYou) classes.push('needs-you')
  return (
    // Its tool's `--kind` colour, as the board's tag reads it, inherited by the row.
    <li data-kind={row.tool}>
      <button
        type="button"
        className={classes.join(' ')}
        data-testid="workspace-terminal"
        data-kind={row.kind}
        aria-current={current ? 'true' : undefined}
        title={`${row.title} (${toolName(row)})`}
        onClick={() => onOpen(row.workspaceId, row.cardId)}
      >
        <span className="workspace-terminal-kind" data-testid="workspace-terminal-kind">
          <ToolIcon tool={row.tool} />
        </span>
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
        <StatusMark activity={row.activity} />
      </button>
    </li>
  )
}

/** What a row runs, for its tooltip: a shell, a plain card's shell, an agent or a command. */
function toolName(row: OpenTerminal): string {
  if (row.kind === 'shell') return 'shell'
  if (row.tool === 'claude') return 'Claude Code'
  if (isAgentKind(row.tool)) return AGENT_PRESETS[row.tool].label
  return row.tool === 'custom' ? 'Custom command' : 'Shell'
}

/**
 * The terminal's status: a green dot while it runs with nothing to report, a spinner while its
 * agent works, an amber bell while it waits for the user (until seen) and an amber question mark
 * while it needs an answer; named by tooltip.
 */
function StatusMark({ activity }: { activity: OpenTerminal['activity'] }): React.JSX.Element {
  const status = activity ?? 'running'
  const label = activity ? ACTIVITY_LABELS[activity] : 'Running'
  const Icon =
    status === 'waiting'
      ? BellDot
      : status === 'question'
        ? MessageCircleQuestion
        : status === 'working'
          ? LoaderCircle
          : null
  return (
    <span
      className={`workspace-terminal-activity workspace-terminal-${status}`}
      data-testid="workspace-terminal-activity"
      data-activity={status}
      title={label}
      aria-label={label}
    >
      {Icon && <Icon {...SMALL_ICON} />}
    </span>
  )
}

export default WorkspaceTerminals
