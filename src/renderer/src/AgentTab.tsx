import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  LoaderCircle,
  SquareTerminal,
  Workflow,
  X
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import type { Activity } from '../../core/activity'
import { changesView, limitChanges, type ChangeView } from '../../core/agent-changes'
import { clockTime, formatDuration } from '../../core/agent-format'
import {
  AGENT_ROW_STATUS_LABELS,
  agentDuration,
  agentRows,
  foldAgentRows,
  type AgentRow
} from '../../core/agent-rows'
import type { AgentCommand, AgentSummary, AgentTodo } from '../../core/agent-summary'
import { AGENT_TAB_MESSAGES, agentTabSubject, type AgentSummaryRead } from '../../core/agent-tab'
import { commandSteps } from '../../core/command-layout'
import type { Card, Workspace } from '../../core/workspace-store'
import type { ClaudeUsage } from '../../core/claude-usage-types'
import { hasUsage } from '../../core/usage-format'
import {
  AGENT_TAB_GROUPS,
  toggleAgentGroup,
  useCollapsedAgentGroups,
  type AgentTabGroupId
} from './agent-tab-groups'
import { useCardRunState, useCardStatus } from './card-terminals'
import { ChangesList } from './AgentChanges'
import { ContextBar } from './CardLines'
import { SMALL_ICON } from './icons'
import { ShowAllButton } from './ShowAllButton'
import { useShellAgent } from './shell-agents'
import { useCardUsage } from './usage'

/** How long after an answer the tab asks again while it shows (D5). */
const POLL_MS = 1000
/** How many of the newest commands show before `Show all` (D10, #77 C2). */
const SHOWN_COMMANDS = 10
/** How many of What changed's files show before `Show all` (#77 C1). */
const SHOWN_CHANGES = 10

/**
 * The side panel's Agent tab (#75): with a local Claude Code card in front, its current session's
 * conversation, asked of main by folder and session id about every second while the tab shows
 * (D3, D4, D5): the header and the groups; with a running workspace shell in front, the session
 * Claude Code last reported in it, asked of main by its id alone, and the shell's own usage
 * (D3a); else D2's message. The board in front is `card` undefined. Mounted only while the tab
 * is selected and the panel shown, so it asks nothing otherwise.
 */
function AgentTab({
  workspace,
  card
}: {
  workspace: Workspace | undefined
  card: Card | undefined
}): React.JSX.Element {
  const cardId = card?.id ?? ''
  const shellReport = useShellAgent(card?.id)
  const running = useCardRunState(cardId).kind === 'running'
  const { activity } = useCardStatus(cardId)
  const cardUsage = useCardUsage(cardId)
  const subject = agentTabSubject(workspace, card, {
    running,
    sessionId: shellReport?.sessionId
  })
  const folder = subject.kind === 'conversation' ? subject.folder : null
  const sessionId = subject.kind === 'conversation' ? subject.sessionId : null
  const shell = subject.kind === 'conversation' && subject.shell === true
  const read = useAgentSummary(folder, sessionId, shell)

  let body: React.ReactNode
  if (subject.kind === 'message') body = <Message text={subject.text} />
  else if (read === undefined) body = null
  else if (read.state === 'none') body = <Message text={AGENT_TAB_MESSAGES.noConversation} />
  else {
    body = (
      <>
        {read.state === 'error' && (
          <p className="agent-tab-error" data-testid="agent-tab-error" role="alert">
            Couldn&apos;t read the conversation: {read.reason}
          </p>
        )}
        {read.summary && (
          <AgentView
            key={`${folder}\0${sessionId}`}
            summary={read.summary}
            folder={folder ?? ''}
            usage={shell ? shellReport?.usage : cardUsage}
            activity={activity}
            running={running}
          />
        )}
      </>
    )
  }

  return (
    <div className="agent-tab" data-testid="agent-tab">
      {body}
    </div>
  )
}

function Message({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="agent-tab-message" data-testid="agent-tab-message">
      {text}
    </p>
  )
}

/** What the tab shows from main's answers: the last summary is kept below an error (D12). */
type Shown =
  | { state: 'none' }
  | { state: 'conversation'; summary: AgentSummary }
  | { state: 'error'; reason: string; summary?: AgentSummary }

/**
 * Main's answers for this folder and session (a shell's by the session alone, D3a), asked again
 * 1 s after each answer (D5) while mounted; an `unchanged` answer changes nothing. Undefined
 * until the first answer.
 */
function useAgentSummary(
  folder: string | null,
  sessionId: string | null,
  shell: boolean
): Shown | undefined {
  const [answer, setAnswer] = useState<{ key: string; shown: Shown }>()
  const key =
    folder !== null && sessionId !== null ? `${shell ? 'shell' : folder}\0${sessionId}` : null
  useEffect(() => {
    if (folder === null || sessionId === null || key === null) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let version: number | undefined
    let last: AgentSummary | undefined
    const ask = (): void => {
      const request = shell
        ? window.bikube.agentTab.sessionSummary(sessionId, version)
        : window.bikube.agentTab.summary(folder, sessionId, version)
      void request
        .catch((): AgentSummaryRead => ({ state: 'error', reason: 'request failed' }))
        .then((read) => {
          if (!current) return
          if (read.state === 'conversation') {
            version = read.version
            last = read.summary
            setAnswer({ key, shown: { state: 'conversation', summary: read.summary } })
          } else if (read.state === 'none') {
            version = undefined
            last = undefined
            setAnswer({ key, shown: { state: 'none' } })
          } else if (read.state === 'error') {
            version = undefined
            setAnswer({ key, shown: { state: 'error', reason: read.reason, summary: last } })
          }
          timer = setTimeout(ask, POLL_MS)
        })
    }
    ask()
    return () => {
      current = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [folder, sessionId, shell, key])
  return answer && answer.key === key ? answer.shown : undefined
}

/** The header and the three groups under it (D6), collapsed ones kept for the run of the app. */
function AgentView({
  summary,
  folder,
  usage,
  activity,
  running
}: {
  summary: AgentSummary
  /** The card's or shell's folder: What changed groups by it and opens files in it (D9). */
  folder: string
  /** The card's usage as the board card shows it, or the shell's kept usage (D7, D3a). */
  usage: ClaudeUsage | undefined
  /** The card's or shell's activity (#31), for the main agent's status (D8). */
  activity: Activity | undefined
  /** Whether the card's or shell's shell runs: a background command is stopped without it. */
  running: boolean
}): React.JSX.Element {
  const collapsed = useCollapsedAgentGroups()
  const [allCommands, setAllCommands] = useState(false)
  const commands = summary.commands.slice().reverse()
  const shownCommands = allCommands ? commands : commands.slice(0, SHOWN_COMMANDS)
  const [allAgents, setAllAgents] = useState(false)
  const { shown, finished } = foldAgentRows(agentRows(activity, summary.agents, running))
  const [changeView, setChangeView] = useState<ChangeView>({ kind: 'last' })
  const [allChanges, setAllChanges] = useState(false)
  const changes = changesView(summary, folder, changeView)
  const cutChanges = limitChanges(changes, SHOWN_CHANGES)
  const counts: Record<AgentTabGroupId, number> = {
    agents: shown.length + (allAgents ? finished.length : 0),
    changes: allChanges ? changes.count : changes.count - cutChanges.more,
    commands: shownCommands.length
  }
  return (
    <>
      <AgentHeader summary={summary} usage={usage} />
      <div className="agent-tab-groups">
        {AGENT_TAB_GROUPS.map((group) => (
          <AgentGroup
            key={group.id}
            id={group.id}
            name={group.name}
            count={counts[group.id]}
            open={!collapsed.has(group.id)}
          >
            {group.id === 'agents' && (
              <AgentList
                rows={shown}
                finished={finished}
                showFinished={allAgents}
                onToggleFinished={() => setAllAgents(!allAgents)}
              />
            )}
            {group.id === 'changes' && (
              <ChangesList
                summary={summary}
                folder={folder}
                view={changeView}
                onView={(view) => {
                  setChangeView(view)
                  setAllChanges(false)
                }}
                shown={changes}
                groups={allChanges ? changes.groups : cutChanges.groups}
                more={cutChanges.more}
                all={allChanges}
                onToggleAll={() => setAllChanges(!allChanges)}
              />
            )}
            {group.id === 'commands' && (
              <CommandList
                commands={shownCommands}
                more={Math.max(0, commands.length - SHOWN_COMMANDS)}
                all={allCommands}
                onToggleAll={() => setAllCommands(!allCommands)}
              />
            )}
          </AgentGroup>
        ))}
      </div>
    </>
  )
}

/** The model, the board card's context bar and the todo list (D7); each absent without data. */
function AgentHeader({
  summary,
  usage
}: {
  summary: AgentSummary
  usage: ClaudeUsage | undefined
}): React.JSX.Element | null {
  const withUsage = hasUsage(usage)
  if (summary.model === null && !withUsage && summary.todos.length === 0) return null
  return (
    <div className="agent-tab-header" data-testid="agent-tab-header">
      {summary.model !== null && (
        <p className="agent-tab-model" data-testid="agent-tab-model">
          {summary.model}
        </p>
      )}
      {withUsage && <ContextBar usage={usage} />}
      {summary.todos.length > 0 && <Todos todos={summary.todos} />}
    </div>
  )
}

function Todos({ todos }: { todos: AgentTodo[] }): React.JSX.Element {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="agent-todos" data-testid="agent-todos">
      <div className="agent-todos-head">
        <span className="agent-todos-count" data-testid="agent-todos-count">
          {done}/{todos.length}
        </span>
        <span
          className="agent-todos-track"
          role="progressbar"
          aria-label="Todos done"
          aria-valuemin={0}
          aria-valuemax={todos.length}
          aria-valuenow={done}
        >
          <span className="agent-todos-fill" style={{ width: `${(done / todos.length) * 100}%` }} />
        </span>
      </div>
      <ul className="agent-todo-list">
        {todos.map((todo, i) => (
          <li key={i} className="agent-todo" data-testid="agent-todo" data-status={todo.status}>
            {todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** How often a running row's duration is redrawn (D8). */
const TICK_MS = 1000

/** The clock, read again every second while `live`, for running rows' durations. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [live])
  return now
}

const ROW_ICONS: Record<AgentRow['kind'], typeof Bot> = {
  main: Bot,
  subagent: Workflow,
  background: SquareTerminal
}

/**
 * The Agents group's rows (D8): the main agent first, then subagents and background commands
 * newest first, finished ones past the latest 5 folded into one `N finished` row that expands.
 */
function AgentList({
  rows,
  finished,
  showFinished,
  onToggleFinished
}: {
  rows: AgentRow[]
  finished: AgentRow[]
  showFinished: boolean
  onToggleFinished: () => void
}): React.JSX.Element {
  const finishedId = useId()
  const now = useNow(rows.some((row) => row.kind !== 'main' && row.status === 'running'))
  return (
    <>
      <ul className="agent-rows">
        {rows.map((row, i) => (
          <AgentRowItem key={row.id ?? `main${i}`} row={row} now={now} />
        ))}
      </ul>
      {finished.length > 0 && (
        <>
          <button
            type="button"
            className="agent-rows-finished"
            data-testid="agent-rows-finished"
            aria-expanded={showFinished}
            aria-controls={finishedId}
            onClick={onToggleFinished}
          >
            <ChevronRight {...SMALL_ICON} className="agent-setup-expand-icon" />
            {finished.length} finished
          </button>
          <ul id={finishedId} className="agent-rows" hidden={!showFinished}>
            {showFinished &&
              finished.map((row, i) => (
                <AgentRowItem key={row.id ?? `finished${i}`} row={row} now={now} />
              ))}
          </ul>
        </>
      )}
    </>
  )
}

/** One Agents row: its icon, name and description, status, duration and tool uses. */
function AgentRowItem({ row, now }: { row: AgentRow; now: number }): React.JSX.Element {
  const Icon = ROW_ICONS[row.kind]
  const duration = agentDuration(row, now)
  const tools = row.toolUses ?? null
  return (
    <li className="agent-row" data-testid="agent-row" data-kind={row.kind}>
      <Icon {...SMALL_ICON} className="agent-row-icon" />
      <span className="agent-row-text">
        <span className="agent-row-line">
          <span className="agent-row-name" data-testid="agent-row-name">
            {row.name}
          </span>
          <StatusMark
            testId="agent-row-status"
            status={row.status}
            label={AGENT_ROW_STATUS_LABELS[row.status]}
          />
        </span>
        {(row.description || duration !== null || tools !== null) && (
          <span className="agent-row-line agent-row-sub">
            {row.description && (
              <span className="agent-row-description" data-testid="agent-row-description">
                {row.description}
              </span>
            )}
            {duration !== null && (
              <span data-testid="agent-row-duration">{formatDuration(duration)}</span>
            )}
            {tools !== null && (
              <span data-testid="agent-row-tools">
                {tools} {tools === 1 ? 'tool use' : 'tool uses'}
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  )
}

/** The Commands group's rows, newest first, each expanding on a click or Enter (D10). */
function CommandList({
  commands,
  more,
  all,
  onToggleAll
}: {
  commands: AgentCommand[]
  /** The commands past the newest `SHOWN_COMMANDS` (#77 C2). */
  more: number
  all: boolean
  onToggleAll: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (commands.length === 0) {
    return (
      <p className="agent-tab-empty" data-testid="agent-commands-empty">
        No commands yet.
      </p>
    )
  }
  const toggle = (id: string): void => {
    const next = new Set(open)
    if (!next.delete(id)) next.add(id)
    setOpen(next)
  }
  return (
    <>
      <ul className="agent-commands">
        {commands.map((command) => (
          <CommandRow
            key={command.id}
            command={command}
            open={open.has(command.id)}
            onToggle={() => toggle(command.id)}
          />
        ))}
      </ul>
      <ShowAllButton
        testId="agent-commands-show-all"
        more={more}
        all={all}
        onToggle={onToggleAll}
      />
    </>
  )
}

const firstLine = (text: string): string => text.split('\n', 1)[0]

const STATUS_LABELS: Record<Exclude<AgentCommand['status'], 'failed'>, string> = {
  running: 'Running',
  ok: 'OK',
  denied: 'Denied',
  background: 'Background'
}

const statusLabel = (command: AgentCommand): string =>
  command.status === 'failed'
    ? command.exitCode === null
      ? 'Failed'
      : `Failed · exit ${command.exitCode}`
    : STATUS_LABELS[command.status]

/** The word a quiet status keeps in view on the right: `exit 1`, `Denied` or `Background`. */
const statusNote = (command: AgentCommand): string =>
  command.status === 'failed' && command.exitCode !== null
    ? `exit ${command.exitCode}`
    : statusLabel(command)

function CommandRow({
  command,
  open,
  onToggle
}: {
  command: AgentCommand
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const detailId = useId()
  const duration =
    command.startedAt !== null && command.endedAt !== null && command.status !== 'background'
      ? formatDuration(command.endedAt - command.startedAt)
      : null
  return (
    <li className="agent-command" data-testid="agent-command" data-status={command.status}>
      <button
        type="button"
        className="agent-command-toggle"
        data-testid="agent-command-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="agent-command-head">
          <StatusMark
            testId="agent-command-status"
            status={command.status}
            label={statusLabel(command)}
            quiet
          />
          <span className="agent-command-title" data-testid="agent-command-title">
            {command.description ?? firstLine(command.command)}
          </span>
          {command.agent !== null && (
            <span className="agent-command-agent" data-testid="agent-command-agent">
              {command.agent}
            </span>
          )}
          {command.status !== 'ok' && command.status !== 'running' && (
            <span className="agent-command-note" data-status={command.status} aria-hidden="true">
              {statusNote(command)}
            </span>
          )}
          {duration !== null && (
            <span className="agent-command-duration" data-testid="agent-command-duration">
              {duration}
            </span>
          )}
        </span>
        {command.description !== null && (
          <span className="agent-command-line" data-testid="agent-command-line">
            {firstLine(command.command)}
          </span>
        )}
      </button>
      {open && (
        <div className="agent-command-detail" id={detailId} data-testid="agent-command-detail">
          <CommandSteps command={command.command} />
          {command.output.length > 0 && (
            <pre className="agent-command-output" data-testid="agent-command-output">
              {command.output.join('\n')}
            </pre>
          )}
          <div className="agent-command-actions">
            <CopyButton text={command.command} />
            {command.startedAt !== null && (
              <span className="agent-command-time" data-testid="agent-command-time">
                Started {clockTime(command.startedAt)}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

const STATUS_ICONS: Partial<Record<string, typeof Bot>> = {
  ok: Check,
  done: Check,
  failed: X,
  denied: Ban,
  background: SquareTerminal
}

/**
 * A command's or agent row's status as a coloured icon and word, no chip; `quiet` keeps only the
 * icon in view (the word still read out), for the statuses most rows have.
 */
function StatusMark({
  testId,
  status,
  label,
  quiet = false
}: {
  testId: string
  status: string
  label: string
  quiet?: boolean
}): React.JSX.Element {
  const Icon = status === 'running' ? LoaderCircle : STATUS_ICONS[status]
  return (
    <span className="agent-status" data-testid={testId} data-status={status} title={label}>
      {Icon && (
        <Icon
          {...SMALL_ICON}
          className={
            status === 'running' ? 'agent-status-icon agent-command-spinner' : 'agent-status-icon'
          }
        />
      )}
      <span className={quiet && Icon ? 'visually-hidden' : undefined}>{label}</span>
    </span>
  )
}

/**
 * The command one step per line, coloured from the theme (D10), its operator in a gutter so every
 * step's command, and its wrapped lines, start in the same column.
 */
function CommandSteps({ command }: { command: string }): React.JSX.Element {
  const steps = commandSteps(command)
  return (
    <div
      className="agent-command-steps"
      data-testid="agent-command-steps"
      data-gutter={steps.length > 1}
    >
      {steps.map((step, i) => (
        <div
          key={i}
          className={step.dim ? 'agent-command-step agent-command-step-dim' : 'agent-command-step'}
          data-testid="agent-command-step"
          data-dim={step.dim}
        >
          {step.operator !== null && <span className="cmd-operator">{step.operator} </span>}
          <span className="agent-command-step-text">
            {step.parts.map((part, j) => (
              <span key={j} className={`cmd-${part.kind}`}>
                {part.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-small agent-command-copy"
      data-testid="agent-command-copy"
      onClick={() => {
        void window.bikube.clipboard.write(text)
        setCopied(true)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** A group's heading button (chevron, name, count of rows shown) and its rows (D6). */
export function AgentGroup({
  id,
  name,
  count,
  open,
  children
}: {
  id: AgentTabGroupId
  name: string
  count: number
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const rowsId = useId()
  return (
    <section className="agent-tab-group" data-testid="agent-tab-group" data-group={id}>
      <h3 className="agent-tab-group-heading">
        <button
          type="button"
          className="agent-setup-group-toggle"
          data-testid="agent-tab-group-toggle"
          aria-expanded={open}
          aria-controls={rowsId}
          onClick={() => toggleAgentGroup(id)}
        >
          <ChevronRight {...SMALL_ICON} className="agent-setup-expand-icon" />
          <span className="agent-setup-group-title" data-testid="agent-tab-group-name">
            {name}
          </span>{' '}
          <span className="agent-setup-group-count" data-testid="agent-tab-group-count">
            {count}
          </span>
        </button>
      </h3>
      <div id={rowsId} className="agent-tab-group-rows" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

export default AgentTab
