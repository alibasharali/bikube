/**
 * The Agent tab's agent summary (#75 D7, D8, D10, D11): Claude Code transcript lines parsed into
 * the main agent's model and todo list, every subagent and background command with its status and
 * times, and every `Bash` command with its status, duration and output tail. No Node imports: main
 * feeds it the lines it tails (`agent-transcript.ts`), Vitest fixture lines. One
 * `TranscriptState` holds a whole conversation: the main transcript's lines come through
 * `addTranscriptLine` with `agent` null, each subagent transcript's through `addSubagentLine`
 * with its file's name; a subagent file is matched to its `Task` tool use by the agent id the
 * tool's result names, else by its first prompt, and its commands are tagged with the subagent's
 * name.
 */

/** D11's caps on what the summary carries. */
export const SUMMARY_LIMITS = {
  command: 4000,
  description: 300,
  outputLines: 20,
  outputLineChars: 500,
  commands: 2000,
  /** Subagents and background commands together. */
  agents: 500,
  /** A background command's name when it has no description. */
  agentName: 60,
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

/**
 * A subagent's or background command's state (D8): `running` until the transcript shows its end;
 * `stopped` for one killed. A background command whose shell has stopped is the renderer's to
 * show as stopped.
 */
export type AgentTaskStatus = 'running' | 'done' | 'failed' | 'stopped'

/** A subagent (a `Task` or `Agent` tool use) or a background command (D8). */
export interface AgentTask {
  /** The tool use's id. */
  id: string
  kind: 'subagent' | 'background'
  /** The subagent's type, else `Subagent`; the command's description, else its first characters. */
  name: string
  /** The subagent's task description, or null (always null for a background command). */
  description: string | null
  status: AgentTaskStatus
  startedAt: number | null
  endedAt: number | null
  /** A subagent's tool uses, from its own transcript or its result's total; null while unknown. */
  toolUses: number | null
}

export interface AgentSummary {
  /** The main agent's latest assistant entry's model. */
  model: string | null
  /** The main agent's latest todo list; empty when it wrote none. */
  todos: AgentTodo[]
  /** Every `Bash` tool use, oldest first. */
  commands: AgentCommand[]
  /** Every subagent and background command, oldest first; absent while there are none. */
  agents?: AgentTask[]
}

/** A subagent transcript read so far. */
interface SubagentFile {
  /** The agent id its file name or entries carry. */
  agentId: string | null
  /** Its first user entry's text: the `Task`'s prompt. */
  prompt: string | null
  toolUses: number
}

/** What a `Task` tool use's own result and notifications say, kept apart from what is sent. */
interface TaskLink {
  prompt: string | null
  agentId: string | null
  /** The result's or notification's total of tool uses. */
  toolUses: number | null
  /** A background command's shell id. */
  shellId: string | null
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
  /** Subagents and background commands, oldest first, by tool use id too. */
  agents: AgentTask[]
  agentsById: Map<string, AgentTask>
  links: Map<string, TaskLink>
  /** Subagent transcripts by file name, in the order they were first read. */
  files: Map<string, SubagentFile>
  /** Commands read from a subagent transcript: the file they came from. */
  commandFiles: Map<string, string>
  /** A `BashOutput`, `KillShell` or `TaskStop` tool use waiting for its result: the shell it names. */
  shellQueries: Map<string, { shellId: string; kill: boolean }>
}

export function newTranscriptState(): TranscriptState {
  return {
    model: null,
    todoSource: 'todoWrite',
    todos: [],
    tasks: new Map(),
    pendingTasks: new Map(),
    commands: [],
    byId: new Map(),
    agents: [],
    agentsById: new Map(),
    links: new Map(),
    files: new Map(),
    commandFiles: new Map(),
    shellQueries: new Map()
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

function addCommand(state: TranscriptState, command: AgentCommand, file: string | null): void {
  if (state.byId.has(command.id)) return
  state.commands.push(command)
  state.byId.set(command.id, command)
  if (file !== null) state.commandFiles.set(command.id, file)
  while (state.commands.length > SUMMARY_LIMITS.commands) {
    const dropped = state.commands.shift()
    if (dropped) {
      state.byId.delete(dropped.id)
      state.commandFiles.delete(dropped.id)
    }
  }
}

function addAgent(state: TranscriptState, task: AgentTask, link: TaskLink): void {
  if (state.agentsById.has(task.id)) return
  state.agents.push(task)
  state.agentsById.set(task.id, task)
  state.links.set(task.id, link)
  while (state.agents.length > SUMMARY_LIMITS.agents) {
    const dropped = state.agents.shift()
    if (dropped) {
      state.agentsById.delete(dropped.id)
      state.links.delete(dropped.id)
    }
  }
}

/** The shell id a `BashOutput`, `KillShell` (`KillBash`) or `TaskOutput`/`TaskStop` names. */
const SHELL_QUERIES: Record<string, boolean> = {
  BashOutput: false,
  TaskOutput: false,
  KillShell: true,
  KillBash: true,
  TaskStop: true
}

const shellIdOf = (input: Json): string | null => {
  for (const key of ['bash_id', 'shell_id', 'task_id', 'shellId', 'taskId']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

function toolUse(
  state: TranscriptState,
  use: Json,
  at: number | null,
  agent: string | null,
  file: string | null
): void {
  const input = isObject(use.input) ? use.input : {}
  const id = typeof use.id === 'string' ? use.id : null
  const main = agent === null && file === null
  if (id !== null && (use.name === 'Task' || use.name === 'Agent')) {
    addAgent(
      state,
      {
        id,
        kind: 'subagent',
        name: text(input.subagent_type, SUMMARY_LIMITS.description) ?? 'Subagent',
        description: text(input.description, SUMMARY_LIMITS.description),
        status: 'running',
        startedAt: at,
        endedAt: null,
        toolUses: null
      },
      {
        prompt: typeof input.prompt === 'string' ? input.prompt : null,
        agentId: null,
        toolUses: null,
        shellId: null
      }
    )
  } else if (id !== null && typeof use.name === 'string' && use.name in SHELL_QUERIES) {
    const shellId = shellIdOf(input)
    if (shellId !== null) state.shellQueries.set(id, { shellId, kill: SHELL_QUERIES[use.name] })
  } else if (use.name === 'Bash' && id !== null && typeof input.command === 'string') {
    const background = input.run_in_background === true
    const description = text(input.description, SUMMARY_LIMITS.description)
    if (background) {
      addAgent(
        state,
        {
          id,
          kind: 'background',
          name: description ?? input.command.slice(0, SUMMARY_LIMITS.agentName),
          description: null,
          status: 'running',
          startedAt: at,
          endedAt: null,
          toolUses: null
        },
        { prompt: null, agentId: null, toolUses: null, shellId: null }
      )
    }
    addCommand(
      state,
      {
        id,
        description: text(input.description, SUMMARY_LIMITS.description),
        command: input.command.slice(0, SUMMARY_LIMITS.command),
        status: input.run_in_background === true ? 'background' : 'running',
        exitCode: null,
        startedAt: at,
        endedAt: null,
        output: [],
        agent
      },
      file
    )
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

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/** A task notification's or a shell query's final status, as the agent row reads it. */
function endStatus(status: string): AgentTaskStatus | null {
  if (status === 'completed' || status === 'success' || status === 'done') return 'done'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'killed' || status === 'stopped' || status === 'cancelled') return 'stopped'
  return null
}

function endAgent(task: AgentTask, status: AgentTaskStatus, at: number | null): void {
  if (task.status !== 'running') return
  task.status = status
  task.endedAt = at
}

/** A `Task`'s result: a launched background subagent goes on, any other ends it (D8). */
function subagentResult(
  task: AgentTask,
  link: TaskLink,
  result: Json,
  at: number | null,
  extra: unknown
): void {
  const info = isObject(extra) ? extra : {}
  if (typeof info.agentId === 'string' && info.agentId !== '') link.agentId = info.agentId
  link.toolUses = count(info.totalToolUseCount) ?? link.toolUses
  if (info.isAsync === true || info.status === 'async_launched') return
  endAgent(task, result.is_error === true ? 'failed' : 'done', at)
}

/** The shell a background `Bash`'s result names. */
function backgroundShellId(content: string, extra: unknown): string | null {
  if (isObject(extra)) {
    for (const key of ['backgroundTaskId', 'shellId', 'bashId', 'taskId']) {
      const value = extra[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return /running in background with ID: ?([\w-]+)/.exec(content)?.[1] ?? null
}

function agentByShell(state: TranscriptState, shellId: string): AgentTask | undefined {
  for (const [id, link] of state.links) {
    if (link.shellId === shellId) return state.agentsById.get(id)
  }
  return undefined
}

/** A `BashOutput`'s or a kill's result: the background command's end when it names one. */
function shellQueryResult(
  state: TranscriptState,
  query: { shellId: string; kill: boolean },
  result: Json,
  content: string,
  at: number | null,
  extra: unknown
): void {
  const task = agentByShell(state, query.shellId)
  if (!task) return
  if (query.kill) {
    if (result.is_error !== true) endAgent(task, 'stopped', at)
    return
  }
  const status =
    isObject(extra) && typeof extra.status === 'string'
      ? extra.status
      : /<status>(\w+)<\/status>/.exec(content)?.[1]
  const ended = status === undefined ? null : endStatus(status)
  if (ended !== null) endAgent(task, ended, at)
}

function toolResult(state: TranscriptState, result: Json, at: number | null, extra: unknown): void {
  if (typeof result.tool_use_id !== 'string') return
  const content = resultText(result.content)
  const query = state.shellQueries.get(result.tool_use_id)
  if (query) {
    state.shellQueries.delete(result.tool_use_id)
    shellQueryResult(state, query, result, content, at, extra)
    return
  }
  const task = state.agentsById.get(result.tool_use_id)
  const link = state.links.get(result.tool_use_id)
  if (task && link && task.kind === 'subagent') {
    subagentResult(task, link, result, at, extra)
    return
  }
  if (task && link && task.kind === 'background') {
    link.shellId = backgroundShellId(content, extra) ?? link.shellId
  }
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

const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g

const tag = (body: string, name: string): string | undefined =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1]?.trim()

/** The texts an entry may carry a background-task notification in. */
function entryTexts(entry: Json): string[] {
  const texts: string[] = []
  if (entry.type === 'queue-operation' && entry.operation === 'enqueue') {
    if (typeof entry.content === 'string') texts.push(entry.content)
  }
  if (isObject(entry.attachment) && typeof entry.attachment.prompt === 'string') {
    texts.push(entry.attachment.prompt)
  }
  if (entry.type === 'user' && isObject(entry.message)) {
    const content = entry.message.content
    if (typeof content === 'string') texts.push(content)
    else texts.push(resultText(content))
  }
  return texts
}

/**
 * Claude Code's background-task notifications (a background subagent finished, a background
 * command ended): each names the tool use or the shell, and a final status.
 */
function notifications(state: TranscriptState, entry: Json, at: number | null): void {
  for (const text of entryTexts(entry)) {
    if (!text.includes('<task-notification>')) continue
    for (const match of text.matchAll(NOTIFICATION)) {
      const body = match[1]
      const useId = tag(body, 'tool-use-id')
      const taskId = tag(body, 'task-id')
      const status = tag(body, 'status')
      const task =
        (useId !== undefined ? state.agentsById.get(useId) : undefined) ??
        (taskId !== undefined ? agentByShell(state, taskId) : undefined)
      const ended = status === undefined ? null : endStatus(status)
      if (!task || ended === null) continue
      const link = state.links.get(task.id)
      const uses = count(Number(tag(body, 'tool_uses') ?? NaN))
      if (link && uses !== null) link.toolUses = uses
      endAgent(task, ended, at)
    }
  }
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
  addLine(state, line, agent, null)
}

/**
 * Adds one line of the subagent transcript `file` (its file name without `.jsonl`, e.g.
 * `agent-a1b2`) to `state`: its first user entry is the prompt it was matched by, its tool uses
 * are counted, and its commands are tagged with the subagent's name once it is matched.
 */
export function addSubagentLine(state: TranscriptState, file: string, line: string): void {
  let read = state.files.get(file)
  if (!read) {
    read = { agentId: /^agent-(.+)$/.exec(file)?.[1] ?? null, prompt: null, toolUses: 0 }
    state.files.set(file, read)
  }
  const entry = parse(line)
  if (!isObject(entry)) return
  if (read.agentId === null && typeof entry.agentId === 'string') read.agentId = entry.agentId
  if (read.prompt === null && entry.type === 'user' && isObject(entry.message)) {
    const content = entry.message.content
    read.prompt = typeof content === 'string' ? content : resultText(content)
  }
  if (entry.type === 'assistant') read.toolUses += blocks(entry, 'tool_use').length
  addLine(state, line, null, file, entry)
}

function addLine(
  state: TranscriptState,
  line: string,
  agent: string | null,
  file: string | null,
  parsed?: unknown
): void {
  const entry = parsed ?? parse(line)
  if (!isObject(entry)) return
  const main = agent === null && file === null
  if (main && entry.isSidechain === true) return
  const at = timestamp(entry)
  notifications(state, entry, at)
  if (entry.type === 'assistant') {
    const message = entry.message
    if (
      main &&
      isObject(message) &&
      typeof message.model === 'string' &&
      message.model !== '' &&
      message.model !== '<synthetic>'
    ) {
      state.model = message.model.slice(0, SUMMARY_LIMITS.model)
    }
    for (const use of blocks(entry, 'tool_use')) toolUse(state, use, at, agent, file)
  } else if (entry.type === 'user') {
    for (const result of blocks(entry, 'tool_result')) {
      toolResult(state, result, at, entry.toolUseResult)
    }
  }
}

/**
 * Each subagent file's subagent (its tool use id): by the agent id the `Task`'s result named,
 * else the first not yet matched `Task` whose prompt is the file's first prompt.
 */
function matchFiles(state: TranscriptState): Map<string, string> {
  const byAgentId = new Map<string, string>()
  for (const [id, link] of state.links) if (link.agentId !== null) byAgentId.set(link.agentId, id)
  const matched = new Map<string, string>()
  const taken = new Set<string>()
  const waiting: [string, SubagentFile][] = []
  for (const [name, file] of state.files) {
    const id = file.agentId === null ? undefined : byAgentId.get(file.agentId)
    if (id !== undefined && !taken.has(id)) {
      matched.set(name, id)
      taken.add(id)
    } else waiting.push([name, file])
  }
  for (const [name, file] of waiting) {
    if (file.prompt === null) continue
    for (const task of state.agents) {
      const link = state.links.get(task.id)
      if (task.kind !== 'subagent' || taken.has(task.id) || link?.prompt !== file.prompt) continue
      matched.set(name, task.id)
      taken.add(task.id)
      break
    }
  }
  return matched
}

/** The summary of everything read so far: copies, so later lines never change a sent one. */
export function agentSummary(state: TranscriptState): AgentSummary {
  const todos = state.todoSource === 'tasks' ? [...state.tasks.values()] : state.todos
  const matched = matchFiles(state)
  const fileUses = new Map<string, number>()
  for (const [name, id] of matched) fileUses.set(id, state.files.get(name)?.toolUses ?? 0)
  const nameOf = (file: string): string => {
    const id = matched.get(file)
    return (id !== undefined ? state.agentsById.get(id)?.name : undefined) ?? 'Subagent'
  }
  const summary: AgentSummary = {
    model: state.model,
    todos: todos.map((t) => ({ ...t })),
    commands: state.commands.map((c) => {
      const file = state.commandFiles.get(c.id)
      return { ...c, output: [...c.output], ...(file !== undefined && { agent: nameOf(file) }) }
    })
  }
  if (state.agents.length > 0) {
    summary.agents = state.agents.map((task) => ({
      ...task,
      toolUses:
        task.kind === 'subagent'
          ? (state.links.get(task.id)?.toolUses ?? fileUses.get(task.id) ?? null)
          : null
    }))
  }
  return summary
}
