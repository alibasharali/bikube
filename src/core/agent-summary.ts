/**
 * The Agent tab's agent summary (#75 D7, D10, D11): Claude Code transcript lines parsed into the
 * main agent's model and todo list and every `Bash` command with its status, duration and output
 * tail. No Node imports: main feeds it the lines it tails (`agent-transcript.ts`), Vitest fixture
 * lines. One `TranscriptState` holds a whole conversation: the main transcript's lines come with
 * `agent` null, a subagent transcript's (S3) with the subagent's name, which tags its commands.
 */

/** D11's caps on what the summary carries. */
export const SUMMARY_LIMITS = {
  command: 4000,
  description: 300,
  outputLines: 20,
  outputLineChars: 500,
  commands: 2000,
  todos: 200,
  model: 200
} as const

/**
 * A command's chip (D10): `running` until its result, `ok`, `failed` (with `exitCode` when the
 * result names one), `denied` when the user rejected the tool use, `background` for
 * `run_in_background`.
 */
export type CommandStatus = 'running' | 'ok' | 'failed' | 'denied' | 'background'

export interface AgentCommand {
  /** The tool use's id. */
  id: string
  /** Claude's description of it, or null. */
  description: string | null
  command: string
  status: CommandStatus
  exitCode: number | null
  /** The tool use's and its result's timestamps (ms), when the transcript has them. */
  startedAt: number | null
  endedAt: number | null
  /** The last lines of its result's text. */
  output: string[]
  /** The subagent that ran it (its name), or null for the main agent. */
  agent: string | null
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTodo {
  content: string
  status: TodoStatus
  activeForm: string | null
}

export interface AgentSummary {
  /** The main agent's latest assistant entry's model. */
  model: string | null
  /** The main agent's latest todo list; empty when it wrote none. */
  todos: AgentTodo[]
  /** Every `Bash` tool use, oldest first. */
  commands: AgentCommand[]
}

/** A conversation's parse state: fed line by line, read with `agentSummary`. */
export interface TranscriptState {
  model: string | null
  /** Which list the main agent wrote last: a `TodoWrite`'s, or the one its Task tools build. */
  todoSource: 'todoWrite' | 'tasks'
  todos: AgentTodo[]
  /** The Task tools' list by task id, in creation order. */
  tasks: Map<string, AgentTodo>
  /** A `TaskCreate` waiting for its result: the id it was given meanwhile. */
  pendingTasks: Map<string, string>
  commands: AgentCommand[]
  byId: Map<string, AgentCommand>
}

export function newTranscriptState(): TranscriptState {
  return {
    model: null,
    todoSource: 'todoWrite',
    todos: [],
    tasks: new Map(),
    pendingTasks: new Map(),
    commands: [],
    byId: new Map()
  }
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value !== '' ? value.slice(0, max) : null

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const timestamp = (entry: Json): number | null => {
  if (typeof entry.timestamp !== 'string') return null
  const ms = Date.parse(entry.timestamp)
  return Number.isFinite(ms) ? ms : null
}

/** The message's content blocks of `type`. */
function blocks(entry: Json, type: string): Json[] {
  const message = entry.message
  if (!isObject(message) || !Array.isArray(message.content)) return []
  return message.content.filter((b): b is Json => isObject(b) && b.type === type)
}

/**
 * The last `count` lines of `value`, each cut at `max` characters, trailing blank lines dropped;
 * read from the end so a huge output is never split whole.
 */
export function tailLines(value: string, count: number, max: number): string[] {
  let end = value.length
  while (end > 0 && (value[end - 1] === '\n' || value[end - 1] === '\r')) end--
  const lines: string[] = []
  while (end > 0 && lines.length < count) {
    const start = value.lastIndexOf('\n', end - 1) + 1
    lines.unshift(value.slice(start, Math.min(end, start + max)).replace(/\r$/, ''))
    end = start - 1
  }
  return lines
}

/** A tool result's text: its string content, or its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is Json => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

/** The user rejecting the tool use, as Claude Code words it in the result. */
const DENIALS = [
  /^The user doesn't want to (?:proceed with this tool use|take this action)/,
  /^Permission to use \S+ (?:has been|was) denied/
]

const isDenial = (content: string, toolUseResult: unknown): boolean =>
  toolUseResult === 'User rejected tool use' || DENIALS.some((pattern) => pattern.test(content))

const TODO_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

function todoOf(value: unknown): AgentTodo | null {
  if (!isObject(value)) return null
  const content = text(value.content, SUMMARY_LIMITS.description)
  if (content === null || typeof value.status !== 'string') return null
  if (!TODO_STATUSES.includes(value.status)) return null
  return {
    content,
    status: value.status as TodoStatus,
    activeForm: text(value.activeForm, SUMMARY_LIMITS.description)
  }
}

function addCommand(state: TranscriptState, command: AgentCommand): void {
  if (state.byId.has(command.id)) return
  state.commands.push(command)
  state.byId.set(command.id, command)
  while (state.commands.length > SUMMARY_LIMITS.commands) {
    const dropped = state.commands.shift()
    if (dropped) state.byId.delete(dropped.id)
  }
}

function toolUse(state: TranscriptState, use: Json, at: number | null, agent: string | null): void {
  const input = isObject(use.input) ? use.input : {}
  const id = typeof use.id === 'string' ? use.id : null
  const main = agent === null
  if (use.name === 'Bash' && id !== null && typeof input.command === 'string') {
    addCommand(state, {
      id,
      description: text(input.description, SUMMARY_LIMITS.description),
      command: input.command.slice(0, SUMMARY_LIMITS.command),
      status: input.run_in_background === true ? 'background' : 'running',
      exitCode: null,
      startedAt: at,
      endedAt: null,
      output: [],
      agent
    })
  } else if (main && use.name === 'TodoWrite' && Array.isArray(input.todos)) {
    state.todoSource = 'todoWrite'
    state.todos = input.todos
      .map(todoOf)
      .filter((t): t is AgentTodo => t !== null)
      .slice(0, SUMMARY_LIMITS.todos)
  } else if (main && use.name === 'TaskCreate') {
    const content = text(input.subject, SUMMARY_LIMITS.description)
    if (content === null || state.tasks.size >= SUMMARY_LIMITS.todos) return
    const taskId = String(state.tasks.size + 1)
    state.todoSource = 'tasks'
    state.tasks.set(taskId, {
      content,
      status: 'pending',
      activeForm: text(input.activeForm, SUMMARY_LIMITS.description)
    })
    if (id !== null) state.pendingTasks.set(id, taskId)
  } else if (main && use.name === 'TaskUpdate') {
    const taskId =
      typeof input.taskId === 'string' || typeof input.taskId === 'number'
        ? String(input.taskId)
        : null
    const task = taskId === null ? undefined : state.tasks.get(taskId)
    if (taskId === null || !task) return
    state.todoSource = 'tasks'
    if (input.status === 'deleted') {
      state.tasks.delete(taskId)
      return
    }
    state.tasks.set(taskId, {
      content: text(input.subject, SUMMARY_LIMITS.description) ?? task.content,
      status:
        typeof input.status === 'string' && TODO_STATUSES.includes(input.status)
          ? (input.status as TodoStatus)
          : task.status,
      activeForm: text(input.activeForm, SUMMARY_LIMITS.description) ?? task.activeForm
    })
  }
}

/** A `TaskCreate`'s result names the task's real id: the list is keyed by it from then on. */
function taskCreated(state: TranscriptState, useId: string, content: string, extra: unknown): void {
  const given = state.pendingTasks.get(useId)
  if (given === undefined) return
  state.pendingTasks.delete(useId)
  const named =
    isObject(extra) && isObject(extra.task) && extra.task.id !== undefined
      ? String(extra.task.id)
      : /^Task #(\S+) created/.exec(content)?.[1]
  const task = state.tasks.get(given)
  if (named === undefined || named === given || !task || state.tasks.has(named)) return
  const rekeyed = new Map<string, AgentTodo>()
  for (const [key, value] of state.tasks) rekeyed.set(key === given ? named : key, value)
  state.tasks = rekeyed
}

function toolResult(state: TranscriptState, result: Json, at: number | null, extra: unknown): void {
  if (typeof result.tool_use_id !== 'string') return
  const content = resultText(result.content)
  const command = state.byId.get(result.tool_use_id)
  if (!command) {
    taskCreated(state, result.tool_use_id, content, extra)
    return
  }
  command.endedAt = at
  command.output = tailLines(content, SUMMARY_LIMITS.outputLines, SUMMARY_LIMITS.outputLineChars)
  if (command.status === 'background') return
  const interrupted = isObject(extra) && extra.interrupted === true
  if (result.is_error === true && isDenial(content, extra)) command.status = 'denied'
  else if (result.is_error === true || interrupted) {
    command.status = 'failed'
    const code = /^(?:Error: )?Exit code (\d+)/.exec(content)?.[1]
    command.exitCode = code === undefined ? null : Number(code)
  } else command.status = 'ok'
}

/**
 * Adds one transcript line to `state`: `agent` null for the main transcript, else the subagent's
 * name. Lines that aren't JSON entries are skipped, and so are the main transcript's sidechain
 * entries (a subagent's, read from its own transcript).
 */
export function addTranscriptLine(
  state: TranscriptState,
  line: string,
  agent: string | null
): void {
  const entry = parse(line)
  if (!isObject(entry)) return
  if (agent === null && entry.isSidechain === true) return
  const at = timestamp(entry)
  if (entry.type === 'assistant') {
    const message = entry.message
    if (
      agent === null &&
      isObject(message) &&
      typeof message.model === 'string' &&
      message.model !== '' &&
      message.model !== '<synthetic>'
    ) {
      state.model = message.model.slice(0, SUMMARY_LIMITS.model)
    }
    for (const use of blocks(entry, 'tool_use')) toolUse(state, use, at, agent)
  } else if (entry.type === 'user') {
    for (const result of blocks(entry, 'tool_result')) {
      toolResult(state, result, at, entry.toolUseResult)
    }
  }
}

/** The summary of everything read so far: copies, so later lines never change a sent one. */
export function agentSummary(state: TranscriptState): AgentSummary {
  const todos = state.todoSource === 'tasks' ? [...state.tasks.values()] : state.todos
  return {
    model: state.model,
    todos: todos.map((t) => ({ ...t })),
    commands: state.commands.map((c) => ({ ...c, output: [...c.output] }))
  }
}
