import { ChevronRight, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { clockTime, formatDuration } from '../../core/agent-format'
import type { AgentCommand, AgentSummary, AgentTodo } from '../../core/agent-summary'
import { AGENT_TAB_MESSAGES, agentTabSubject, type AgentSummaryRead } from '../../core/agent-tab'
import { commandSteps } from '../../core/command-layout'
import type { Card, Workspace } from '../../core/workspace-store'
import { hasUsage } from '../../core/usage-format'
import {
  AGENT_TAB_GROUPS,
  toggleAgentGroup,
  useCollapsedAgentGroups,
  type AgentTabGroupId
} from './agent-tab-groups'
import { ContextBar } from './CardLines'
import { SMALL_ICON } from './icons'
import { useCardUsage } from './usage'

/** How long after an answer the tab asks again while it shows (D5). */
const POLL_MS = 1000
/** How many of the newest commands show before `Show all` (D10). */
const SHOWN_COMMANDS = 200

/**
 * The side panel's Agent tab (#75): with a local Claude Code card in front, its current session's
 * conversation, asked of main by folder and session id about every second while the tab shows
 * (D3, D4, D5): the header and the groups; else D2's message. The board in front is `card`
 * undefined. Mounted only while the tab is selected and the panel shown, so it asks nothing
 * otherwise.
 */
function AgentTab({
  workspace,
  card
}: {
  workspace: Workspace | undefined
  card: Card | undefined
}): React.JSX.Element {
  const subject = agentTabSubject(workspace, card)
  const folder = subject.kind === 'conversation' ? subject.folder : null
  const sessionId = subject.kind === 'conversation' ? subject.sessionId : null
  const read = useAgentSummary(folder, sessionId)

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
        {read.summary && card && (
          <AgentView key={`${folder}\0${sessionId}`} summary={read.summary} cardId={card.id} />
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
 * Main's answers for this folder and session, asked again 1 s after each answer (D5) while
 * mounted; an `unchanged` answer changes nothing. Undefined until the first answer.
 */
function useAgentSummary(folder: string | null, sessionId: string | null): Shown | undefined {
  const [answer, setAnswer] = useState<{ key: string; shown: Shown }>()
  const key = folder !== null && sessionId !== null ? `${folder}\0${sessionId}` : null
  useEffect(() => {
    if (folder === null || sessionId === null || key === null) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let version: number | undefined
    let last: AgentSummary | undefined
    const ask = (): void => {
      void window.bikube.agentTab
        .summary(folder, sessionId, version)
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
  }, [folder, sessionId, key])
  return answer && answer.key === key ? answer.shown : undefined
}

/** The header and the three groups under it (D6), collapsed ones kept for the run of the app. */
function AgentView({
  summary,
  cardId
}: {
  summary: AgentSummary
  cardId: string
}): React.JSX.Element {
  const collapsed = useCollapsedAgentGroups()
  const [allCommands, setAllCommands] = useState(false)
  const commands = summary.commands.slice().reverse()
  const shownCommands = allCommands ? commands : commands.slice(0, SHOWN_COMMANDS)
  const counts: Record<AgentTabGroupId, number> = {
    agents: 0,
    changes: 0,
    commands: shownCommands.length
  }
  return (
    <>
      <AgentHeader summary={summary} cardId={cardId} />
      <div className="agent-tab-groups">
        {AGENT_TAB_GROUPS.map((group) => (
          <AgentGroup
            key={group.id}
            id={group.id}
            name={group.name}
            count={counts[group.id]}
            open={!collapsed.has(group.id)}
          >
            {group.id === 'commands' && (
              <CommandList
                commands={shownCommands}
                more={commands.length - shownCommands.length}
                onShowAll={() => setAllCommands(true)}
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
  cardId
}: {
  summary: AgentSummary
  cardId: string
}): React.JSX.Element | null {
  const usage = useCardUsage(cardId)
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

/** The Commands group's rows, newest first, each expanding on a click or Enter (D10). */
function CommandList({
  commands,
  more,
  onShowAll
}: {
  commands: AgentCommand[]
  more: number
  onShowAll: () => void
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
      {more > 0 && (
        <button
          type="button"
          className="btn btn-small agent-tab-show-all"
          data-testid="agent-commands-show-all"
          onClick={onShowAll}
        >
          Show all
        </button>
      )}
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
        <span className="agent-command-title" data-testid="agent-command-title">
          {command.description ?? firstLine(command.command)}
        </span>
        <span className="agent-command-line" data-testid="agent-command-line">
          {firstLine(command.command)}
        </span>
        <span className="agent-command-meta">
          <span
            className="agent-command-status"
            data-testid="agent-command-status"
            data-status={command.status}
          >
            {command.status === 'running' && (
              <LoaderCircle {...SMALL_ICON} className="agent-command-spinner" />
            )}
            {statusLabel(command)}
          </span>
          {duration !== null && <span data-testid="agent-command-duration">{duration}</span>}
          {command.startedAt !== null && (
            <span data-testid="agent-command-time">{clockTime(command.startedAt)}</span>
          )}
          {command.agent !== null && (
            <span className="agent-command-agent" data-testid="agent-command-agent">
              {command.agent}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="agent-command-detail" id={detailId} data-testid="agent-command-detail">
          <CommandSteps command={command.command} />
          {command.output.length > 0 && (
            <pre className="agent-command-output" data-testid="agent-command-output">
              {command.output.join('\n')}
            </pre>
          )}
          <CopyButton text={command.command} />
        </div>
      )}
    </li>
  )
}

/** The command one step per line, its operator first, coloured from the theme (D10). */
function CommandSteps({ command }: { command: string }): React.JSX.Element {
  return (
    <div className="agent-command-steps" data-testid="agent-command-steps">
      {commandSteps(command).map((step, i) => (
        <div
          key={i}
          className={step.dim ? 'agent-command-step agent-command-step-dim' : 'agent-command-step'}
          data-testid="agent-command-step"
          data-dim={step.dim}
        >
          {step.operator !== null && <span className="cmd-operator">{step.operator} </span>}
          {step.parts.map((part, j) => (
            <span key={j} className={`cmd-${part.kind}`}>
              {part.text}
            </span>
          ))}
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
