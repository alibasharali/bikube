import { AppWindow, Blocks } from 'lucide-react'
import { ACTIVITY_LABELS } from '../../core/activity'
import { AGENT_PRESETS, isAgentKind } from '../../core/agent-presets'
import type { OpenTerminal } from '../../core/open-terminals'
import { formatAge } from '../../core/status-time'
import { ToolIcon } from './AgentLogo'
import { useInWindow } from './card-windows'
import { SMALL_ICON } from './icons'
import StatusIcon from './StatusIcon'
import { useRedrawClock } from './status-times'

interface WorkspaceTerminalsProps {
  terminals: readonly OpenTerminal[]
  /** The card or shell open at full size in the active workspace, or null. */
  currentId: string | null
  onOpen: (workspaceId: string, cardId: string) => void
  /**
   * While the terminal modifier is held, each row's Ctrl+digit number (Alt+digit off macOS) by
   * card id, shown in place of its logo; else null.
   */
  numbers: ReadonlyMap<string, number> | null
  /** The workspace's Agent setup row while that page is its view (#68 D3), else null. */
  agentSetup?: { current: boolean; onOpen: () => void } | null
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
  onOpen,
  numbers,
  agentSetup = null
}: WorkspaceTerminalsProps): React.JSX.Element | null {
  if (terminals.length === 0 && !agentSetup) return null
  return (
    <ul className="workspace-terminals" data-testid="workspace-terminals">
      {terminals.map((row) => (
        <TerminalRow
          key={row.cardId}
          row={row}
          current={row.cardId === currentId}
          onOpen={onOpen}
          number={numbers?.get(row.cardId) ?? null}
        />
      ))}
      {agentSetup && <AgentSetupRow {...agentSetup} />}
    </ul>
  )
}

/**
 * The workspace's Agent setup page, after its cards and shells while it is the workspace's view
 * (#68 D3): neutral, with no status; a click shows it.
 */
function AgentSetupRow({
  current,
  onOpen
}: {
  current: boolean
  onOpen: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={current ? 'workspace-terminal active' : 'workspace-terminal'}
        data-testid="workspace-agent-setup"
        aria-current={current ? 'true' : undefined}
        title="Agent setup"
        onClick={onOpen}
      >
        <span className="workspace-terminal-kind">
          <Blocks {...SMALL_ICON} />
        </span>
        <span className="workspace-terminal-title">Agent setup</span>
      </button>
    </li>
  )
}

/**
 * A running card's or shell's row. In the Split sidebar's Agents section (#79 D5) it also names
 * its workspace (`workspaceName`), under its title and in its tooltip, and how long it has been
 * in its group (`since`, D6) before its status mark.
 */
export function TerminalRow({
  row,
  current,
  onOpen,
  number,
  workspaceName,
  since
}: {
  row: OpenTerminal
  current: boolean
  onOpen: WorkspaceTerminalsProps['onOpen']
  number: number | null
  workspaceName?: string
  since?: number
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
        title={
          workspaceName === undefined
            ? `${row.title} (${toolName(row)})`
            : `${row.title} (${toolName(row)}) · ${workspaceName}`
        }
        onClick={() => onOpen(row.workspaceId, row.cardId)}
      >
        {number !== null ? (
          <span className="workspace-terminal-kind held-number" data-testid="terminal-number">
            {number}
          </span>
        ) : (
          <span className="workspace-terminal-kind" data-testid="workspace-terminal-kind">
            <ToolIcon tool={row.tool} />
          </span>
        )}
        {workspaceName === undefined ? (
          <span className="workspace-terminal-title" data-testid="workspace-terminal-title">
            {row.title}
          </span>
        ) : (
          <span className="workspace-terminal-text">
            <span className="workspace-terminal-title" data-testid="workspace-terminal-title">
              {row.title}
            </span>
            <span className="workspace-terminal-workspace" data-testid="agent-row-workspace">
              {workspaceName}
            </span>
          </span>
        )}
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
        {workspaceName !== undefined && since !== undefined && <AgentTime since={since} />}
        <StatusMark activity={row.activity} />
      </button>
    </li>
  )
}

/** How long an agent row has been in its group (#79 D5), redrawn every 30 s. */
function AgentTime({ since }: { since: number }): React.JSX.Element {
  const now = useRedrawClock()
  return (
    <span className="workspace-terminal-time" data-testid="agent-row-time">
      {formatAge(now - since)}
    </span>
  )
}

/** What a row runs, for its tooltip: a shell, a plain card's shell, an agent or a command. */
function toolName(row: OpenTerminal): string {
  if (row.kind === 'shell') return 'shell'
  if (row.tool === 'claude') return 'Claude Code'
  if (isAgentKind(row.tool)) return AGENT_PRESETS[row.tool].label
  return row.tool === 'custom' ? 'Custom command' : 'Shell'
}

/** The terminal's status icon (`StatusIcon`), named by tooltip. */
function StatusMark({ activity }: { activity: OpenTerminal['activity'] }): React.JSX.Element {
  const status = activity ?? 'running'
  const label = activity ? ACTIVITY_LABELS[activity] : 'Running'
  return (
    <span
      className="workspace-terminal-activity"
      data-testid="workspace-terminal-activity"
      data-activity={status}
      title={label}
      aria-label={label}
    >
      <StatusIcon status={status} />
    </span>
  )
}

export default WorkspaceTerminals
