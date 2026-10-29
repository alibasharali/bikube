import { describe, expect, it } from 'vitest'
import {
  SUMMARY_LIMITS,
  addTranscriptLine,
  agentSummary,
  newTranscriptState,
  type AgentSummary,
  type TranscriptState
} from './agent-summary'

const T0 = Date.parse('2026-10-29T14:32:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

interface Entry {
  type: string
  timestamp?: string
  isSidechain?: boolean
  message?: unknown
  toolUseResult?: unknown
}

const assistant = (content: unknown[], seconds = 0, model = 'claude-opus-4-8'): Entry => ({
  type: 'assistant',
  timestamp: at(seconds),
  isSidechain: false,
  message: { model, role: 'assistant', content }
})

const bash = (
  id: string,
  command: string,
  description?: string,
  seconds = 0,
  extra: Record<string, unknown> = {}
): Entry =>
  assistant(
    [
      {
        type: 'tool_use',
        id,
        name: 'Bash',
        input: { command, ...(description !== undefined && { description }), ...extra }
      }
    ],
    seconds
  )

const result = (
  id: string,
  content: unknown,
  seconds = 0,
  isError = false,
  toolUseResult?: unknown
): Entry => ({
  type: 'user',
  timestamp: at(seconds),
  isSidechain: false,
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]
  },
  ...(toolUseResult !== undefined && { toolUseResult })
})

const todoWrite = (todos: unknown[], seconds = 0): Entry =>
  assistant(
    [{ type: 'tool_use', id: `todo${seconds}`, name: 'TodoWrite', input: { todos } }],
    seconds
  )

function read(
  entries: (Entry | string)[],
  state: TranscriptState = newTranscriptState()
): AgentSummary {
  for (const entry of entries) {
    addTranscriptLine(state, typeof entry === 'string' ? entry : JSON.stringify(entry), null)
  }
  return agentSummary(state)
}

const DENIAL =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."

describe("the agent summary's commands (#75 D10)", () => {
  it('reads OK, a failed exit code and a denial, in transcript order', () => {
    const summary = read([
      bash('t1', 'git status', 'Show status', 0),
      result('t1', 'On branch main\nnothing to commit', 2, false, { stdout: 'On branch main' }),
      bash('t2', 'cd /repo && npm test | tail -5', 'Run tests', 10),
      result('t2', 'Exit code 1\nFAIL src/a.test.ts\n1 failed', 75, true, 'Error: Exit code 1'),
      bash('t3', 'rm -rf build', 'Remove build', 80),
      result('t3', DENIAL, 81, true, 'User rejected tool use')
    ])
    expect(
      summary.commands.map((c) => [c.description, c.command, c.status, c.exitCode, c.agent])
    ).toEqual([
      ['Show status', 'git status', 'ok', null, null],
      ['Run tests', 'cd /repo && npm test | tail -5', 'failed', 1, null],
      ['Remove build', 'rm -rf build', 'denied', null, null]
    ])
    expect(summary.commands[1]).toMatchObject({
      startedAt: T0 + 10_000,
      endedAt: T0 + 75_000,
      output: ['Exit code 1', 'FAIL src/a.test.ts', '1 failed']
    })
  })

  it('reads Running without a result, Background, Failed without an exit code, text blocks', () => {
    const summary = read([
      bash('a', 'sleep 100'),
      bash('b', 'npm run dev', 'Start dev server', 1, { run_in_background: true }),
      result('b', 'Command running in background with ID: bash_1', 2),
      bash('c', 'curl x', undefined, 3),
      result('c', [{ type: 'text', text: 'boom' }], 4, true)
    ])
    expect(summary.commands.map((c) => [c.status, c.description, c.output])).toEqual([
      ['running', null, []],
      ['background', 'Start dev server', ['Command running in background with ID: bash_1']],
      ['failed', null, ['boom']]
    ])
    expect(summary.commands[0].endedAt).toBeNull()
  })

  it('skips lines that are not JSON or not entries, and other tools', () => {
    const summary = read([
      'not json',
      '{"type":"summary"}',
      assistant([{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/a' } }]),
      result('missing', 'no such tool use'),
      bash('x', 'ls')
    ])
    expect(summary.commands.map((c) => c.command)).toEqual(['ls'])
  })

  it('keeps the last 20 output lines, each cut at 500 characters, and caps the texts (D11)', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    lines[29] = 'x'.repeat(800)
    const summary = read([
      bash('t', 'y'.repeat(5000), 'd'.repeat(400)),
      result('t', `${lines.join('\n')}\n\n`)
    ])
    const [command] = summary.commands
    expect(command.command).toHaveLength(SUMMARY_LIMITS.command)
    expect(command.description).toHaveLength(SUMMARY_LIMITS.description)
    expect(command.output).toHaveLength(20)
    expect(command.output[0]).toBe('line 10')
    expect(command.output[19]).toHaveLength(500)
  })

  it('keeps at most 2,000 commands, dropping the oldest', () => {
    const entries: Entry[] = []
    for (let i = 0; i < SUMMARY_LIMITS.commands + 5; i++) entries.push(bash(`t${i}`, `echo ${i}`))
    entries.push(result('t0', 'late result for a dropped command'))
    const summary = read(entries)
    expect(summary.commands).toHaveLength(SUMMARY_LIMITS.commands)
    expect(summary.commands[0].command).toBe('echo 5')
  })

  it("leaves a subagent's sidechain entries in the main file out (S3 reads them)", () => {
    const sidechain = { ...bash('s', 'ls src', 'List src'), isSidechain: true }
    expect(read([sidechain]).commands).toEqual([])
  })

  it('tags commands read for a subagent with its name', () => {
    const state = newTranscriptState()
    addTranscriptLine(state, JSON.stringify(bash('s', 'ls src', 'List src')), 'Explore')
    expect(agentSummary(state).commands[0].agent).toBe('Explore')
    expect(agentSummary(state).model).toBeNull()
  })
})

describe("the agent summary's header (#75 D7)", () => {
  it("takes the main agent's latest model, never a subagent's or a synthetic one", () => {
    const state = newTranscriptState()
    read(
      [
        assistant([{ type: 'text', text: 'hi' }], 0, 'claude-sonnet-4-5'),
        assistant([{ type: 'text', text: 'hi' }], 1, 'claude-opus-4-8'),
        { ...assistant([], 2, 'claude-haiku-4-5'), isSidechain: true },
        assistant([{ type: 'text', text: 'API Error' }], 3, '<synthetic>')
      ],
      state
    )
    addTranscriptLine(state, JSON.stringify(assistant([], 4, 'claude-haiku-4-5')), 'Explore')
    expect(agentSummary(state).model).toBe('claude-opus-4-8')
  })

  it("reads the last TodoWrite's todos", () => {
    const summary = read([
      todoWrite([{ content: 'Old', status: 'pending', activeForm: 'Olding' }], 0),
      todoWrite(
        [
          { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
          { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
          { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
          { content: 7, status: 'pending' },
          { content: 'Odd', status: 'weird' }
        ],
        1
      )
    ])
    expect(summary.todos).toEqual([
      { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
      { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' }
    ])
  })

  it('builds the list from TaskCreate and TaskUpdate when the session uses those', () => {
    const create = (id: string, subject: string, seconds: number): Entry =>
      assistant(
        [
          {
            type: 'tool_use',
            id,
            name: 'TaskCreate',
            input: { subject, description: 'x', activeForm: `${subject}ing` }
          }
        ],
        seconds
      )
    const update = (taskId: string, status: string, seconds: number): Entry =>
      assistant(
        [{ type: 'tool_use', id: `u${seconds}`, name: 'TaskUpdate', input: { taskId, status } }],
        seconds
      )
    const summary = read([
      todoWrite([{ content: 'Before', status: 'pending', activeForm: 'Before' }], 0),
      create('c1', 'Plan', 1),
      result('c1', 'Task #1 created successfully: Plan', 1, false, { task: { id: '1' } }),
      create('c2', 'Build', 2),
      result('c2', 'Task #2 created successfully: Build', 2),
      create('c3', 'Drop', 3),
      update('1', 'completed', 4),
      update('2', 'in_progress', 5),
      update('3', 'deleted', 6)
    ])
    expect(summary.todos).toEqual([
      { content: 'Plan', status: 'completed', activeForm: 'Planing' },
      { content: 'Build', status: 'in_progress', activeForm: 'Building' }
    ])
  })

  it('has no todos and no model for an empty transcript', () => {
    expect(read([])).toEqual({ model: null, todos: [], commands: [] })
  })
})
