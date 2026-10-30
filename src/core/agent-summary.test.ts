import { describe, expect, it } from 'vitest'
import {
  SUMMARY_LIMITS,
  addSubagentLine,
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
  cwd?: string
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

const task = (id: string, input: Record<string, unknown>, seconds = 0, name = 'Task'): Entry =>
  assistant([{ type: 'tool_use', id, name, input }], seconds)

/** A subagent transcript's first entry: its prompt, as Claude Code writes it. */
const subPrompt = (prompt: string, seconds = 0, agentId?: string): Entry => ({
  type: 'user',
  timestamp: at(seconds),
  isSidechain: true,
  ...(agentId !== undefined && { agentId }),
  message: { role: 'user', content: prompt }
})

const sub = (entry: Entry): string => JSON.stringify({ ...entry, isSidechain: true })

describe("the agent summary's subagents (#75 D8, AC8)", () => {
  it('reads a Task as a running subagent, its transcript tagging its commands by prompt', () => {
    const state = newTranscriptState()
    read(
      [
        task(
          'task1',
          { subagent_type: 'Explore', description: 'Find the panel code', prompt: 'Look for it' },
          5
        )
      ],
      state
    )
    addSubagentLine(state, 'agent-a1', sub(subPrompt('Look for it', 6)))
    addSubagentLine(state, 'agent-a1', sub(bash('s1', 'ls src', 'List src', 7)))
    addSubagentLine(state, 'agent-a1', sub(result('s1', 'a\nb', 8)))
    let summary = agentSummary(state)
    expect(summary.agents).toEqual([
      {
        id: 'task1',
        kind: 'subagent',
        name: 'Explore',
        description: 'Find the panel code',
        status: 'running',
        startedAt: T0 + 5000,
        endedAt: null,
        toolUses: 1
      }
    ])
    expect(summary.commands.map((c) => [c.description, c.agent, c.status])).toEqual([
      ['List src', 'Explore', 'ok']
    ])

    read([result('task1', [{ type: 'text', text: 'Found it' }], 50)], state)
    summary = agentSummary(state)
    expect(summary.agents?.[0]).toMatchObject({ status: 'done', endedAt: T0 + 50_000 })
  })

  it("matches a file by the agent id the Task's result names, and takes the result's tool total", () => {
    const state = newTranscriptState()
    read(
      [
        task('t1', { description: 'One', prompt: 'same' }, 0, 'Agent'),
        task('t2', { subagent_type: 'Plan', description: 'Two', prompt: 'same' }, 1),
        result('t2', 'done', 9, false, { agentId: 'b2', totalToolUseCount: 7 })
      ],
      state
    )
    addSubagentLine(state, 'agent-b2', sub(subPrompt('same', 2)))
    addSubagentLine(state, 'agent-b2', sub(bash('x', 'pwd', 'Where', 3)))
    addSubagentLine(state, 'agent-c3', sub(subPrompt('same', 2)))
    addSubagentLine(state, 'agent-c3', sub(bash('y', 'id', 'Who', 3)))
    addSubagentLine(state, 'agent-d4', sub(subPrompt('unknown', 2)))
    addSubagentLine(state, 'agent-d4', sub(bash('z', 'ls', 'Lost', 3)))
    const summary = agentSummary(state)
    expect(summary.agents?.map((a) => [a.name, a.description, a.status, a.toolUses])).toEqual([
      ['Subagent', 'One', 'running', 1],
      ['Plan', 'Two', 'done', 7]
    ])
    expect(summary.commands.map((c) => [c.description, c.agent])).toEqual([
      ['Where', 'Plan'],
      ['Who', 'Subagent'],
      ['Lost', 'Subagent']
    ])
  })

  it('reads a failed subagent, and a background one running until its notification', () => {
    const notification = (useId: string, status: string, seconds: number): Entry =>
      ({
        type: 'queue-operation',
        timestamp: at(seconds),
        operation: 'enqueue',
        content: `<task-notification>\n<task-id>a9</task-id>\n<tool-use-id>${useId}</tool-use-id>\n<status>${status}</status>\n<usage><tool_uses>12</tool_uses></usage>\n</task-notification>`
      }) as Entry
    const summary = read([
      task('f', { subagent_type: 'Explore', prompt: 'p' }, 0),
      result('f', 'Agent crashed', 4, true),
      task('b', { subagent_type: 'Review', prompt: 'q', run_in_background: true }, 5),
      result('b', 'Async agent launched successfully.', 5, false, {
        isAsync: true,
        status: 'async_launched',
        agentId: 'a9'
      }),
      notification('b', 'completed', 60),
      notification('b', 'completed', 90)
    ])
    expect(
      summary.agents?.map((a) => [a.name, a.status, a.startedAt, a.endedAt, a.toolUses])
    ).toEqual([
      ['Explore', 'failed', T0, T0 + 4000, null],
      ['Review', 'done', T0 + 5000, T0 + 60_000, 12]
    ])
    expect(read([task('b', { prompt: 'q' }, 5)]).agents?.[0].status).toBe('running')
  })

  it('keeps at most 500 subagents and background commands, dropping the oldest (D11)', () => {
    const entries: Entry[] = []
    for (let i = 0; i < SUMMARY_LIMITS.agents + 3; i++)
      entries.push(task(`t${i}`, { prompt: `${i}` }))
    const summary = read(entries)
    expect(summary.agents).toHaveLength(SUMMARY_LIMITS.agents)
    expect(summary.agents?.[0].id).toBe('t3')
  })
})

describe("the agent summary's background commands (#75 D8, AC9)", () => {
  const background = (id: string, command: string, description?: string, seconds = 0): Entry =>
    bash(id, command, description, seconds, { run_in_background: true })

  it('lists a background Bash as running while the transcript shows no end', () => {
    const summary = read([
      background('b1', 'npm run dev', 'Start dev server', 3),
      result('b1', 'Command running in background with ID: bash_1', 4)
    ])
    expect(summary.agents).toEqual([
      {
        id: 'b1',
        kind: 'background',
        name: 'Start dev server',
        description: null,
        status: 'running',
        startedAt: T0 + 3000,
        endedAt: null,
        toolUses: null
      }
    ])
    expect(summary.commands[0].status).toBe('background')
  })

  it('reads a denied background Bash as Denied and a failed one as Failed, both tasks Failed', () => {
    const summary = read([
      background('d', 'npm run dev', 'Start dev server', 0),
      result('d', DENIAL, 2, true, 'User rejected tool use'),
      background('e', 'npm run serve', 'Serve', 3),
      result('e', 'Exit code 127\nsh: serve: not found', 4, true),
      background('f', 'npm run watch', 'Watch', 5),
      result('f', 'Error: spawn failed', 6, true),
      background('ok', 'npm run x', 'X', 7),
      result('ok', 'Command running in background with ID: bash_9', 8)
    ])
    expect(summary.commands.map((c) => [c.description, c.status, c.exitCode, c.endedAt])).toEqual([
      ['Start dev server', 'denied', null, T0 + 2000],
      ['Serve', 'failed', 127, T0 + 4000],
      ['Watch', 'failed', null, T0 + 6000],
      ['X', 'background', null, T0 + 8000]
    ])
    expect(summary.agents?.map((a) => [a.name, a.status, a.endedAt])).toEqual([
      ['Start dev server', 'failed', T0 + 2000],
      ['Serve', 'failed', T0 + 4000],
      ['Watch', 'failed', T0 + 6000],
      ['X', 'running', null]
    ])
  })

  it("ends it by a BashOutput's final status, a kill, or a notification naming its shell", () => {
    const query = (id: string, name: string, input: Record<string, unknown>, s: number): Entry =>
      assistant([{ type: 'tool_use', id, name, input }], s)
    const summary = read([
      background('b1', 'x'.repeat(80), undefined, 0),
      result('b1', 'Command running in background with ID: bash_1', 1),
      background('b2', 'npm run watch', 'Watch', 2),
      result('b2', 'started', 3, false, { backgroundTaskId: 'bash_2' }),
      background('b3', 'make', 'Build', 4),
      result('b3', 'Command running in background with ID: b3shell', 5),
      background('b4', 'sleep 9', 'Sleep', 6),
      result('b4', 'Command running in background with ID: b4shell', 6),
      query('q1', 'BashOutput', { bash_id: 'bash_1' }, 10),
      result('q1', '<status>running</status>', 11),
      query('q2', 'BashOutput', { bash_id: 'bash_1' }, 12),
      result('q2', '<status>failed</status>\n<exit_code>2</exit_code>', 13),
      query('q3', 'KillShell', { shell_id: 'bash_2' }, 20),
      result('q3', 'Successfully killed shell: bash_2', 21),
      {
        type: 'user',
        timestamp: at(30),
        message: {
          role: 'user',
          content:
            '<task-notification>\n<task-id>b3shell</task-id>\n<status>completed</status>\n<summary>Background command "make" completed (exit code 0)</summary>\n</task-notification>'
        }
      }
    ])
    expect(summary.agents?.map((a) => [a.name, a.status, a.endedAt])).toEqual([
      ['x'.repeat(60), 'failed', T0 + 13_000],
      ['Watch', 'stopped', T0 + 21_000],
      ['Build', 'done', T0 + 30_000],
      ['Sleep', 'running', null]
    ])
  })
})

/** A prompt the user typed: a main-agent user entry with text content. */
const prompt = (text: unknown, seconds = 0, extra: Record<string, unknown> = {}): Entry => ({
  type: 'user',
  timestamp: at(seconds),
  isSidechain: false,
  message: { role: 'user', content: text },
  ...extra
})

const tool = (id: string, name: string, input: Record<string, unknown>, seconds = 0): Entry =>
  assistant([{ type: 'tool_use', id, name, input }], seconds)

const reply = (text: string, seconds = 0): Entry => assistant([{ type: 'text', text }], seconds)

describe("the agent summary's prompts and file changes (#75 D9, AC10)", () => {
  it('reads each typed prompt with its last reply, and its file changes once their result is in', () => {
    const summary = read([
      prompt('Add the panel', 0),
      tool('w1', 'Write', { file_path: '/repo/src/a.ts', content: 'a\n'.repeat(10) }, 1),
      result('w1', 'File created successfully at: /repo/src/a.ts', 2, false, {
        type: 'create',
        filePath: '/repo/src/a.ts'
      }),
      tool('e1', 'Edit', { file_path: '/repo/src/b.ts', old_string: 'x', new_string: 'y\nz' }, 3),
      result('e1', 'The file has been updated.', 4, false, {
        filePath: '/repo/src/b.ts',
        structuredPatch: [{ lines: [' keep', '-x', '+y', '+z', ' keep'] }]
      }),
      reply('Added it.', 5),
      prompt([{ type: 'text', text: 'Rename b' }], 10, { cwd: '/repo' }),
      { ...bash('m1', 'cd /repo && git mv src/b.ts src/c.ts', 'Rename', 11), cwd: '/repo' },
      result('m1', '', 12),
      tool('e2', 'Edit', { file_path: '/repo/docs/x.md', old_string: 'a', new_string: 'a\nb' }, 13),
      result('e2', 'The file has been updated.', 14),
      reply('Thinking.', 15),
      reply('Renamed b to c.', 16)
    ])
    expect(summary.prompts).toEqual([
      { number: 1, text: 'Add the panel', reply: 'Added it.', startedAt: T0 },
      { number: 2, text: 'Rename b', reply: 'Renamed b to c.', startedAt: T0 + 10_000 }
    ])
    expect(summary.changes).toEqual([
      { prompt: 1, kind: 'new', path: '/repo/src/a.ts', added: 10, removed: 0 },
      { prompt: 1, kind: 'edit', path: '/repo/src/b.ts', added: 2, removed: 1 },
      {
        prompt: 2,
        kind: 'rename',
        path: '/repo/src/b.ts',
        to: '/repo/src/c.ts',
        added: 0,
        removed: 0
      },
      { prompt: 2, kind: 'edit', path: '/repo/docs/x.md', added: 1, removed: 0 }
    ])
  })

  it('skips meta, command output, tool results, notifications and interruptions as prompts', () => {
    const summary = read([
      prompt('Caveat: the messages below were generated', 0, { isMeta: true }),
      prompt('<command-name>/clear</command-name>', 1),
      prompt('<local-command-stdout></local-command-stdout>', 2),
      prompt('<task-notification><task-id>x</task-id></task-notification>', 3),
      prompt([{ type: 'text', text: '[Request interrupted by user]' }], 4),
      result('nothing', 'a result', 5),
      prompt('Real one', 6)
    ])
    expect(summary.prompts?.map((p) => p.text)).toEqual(['Real one'])
  })

  it('leaves out failed, denied and pending edits, and failed or unsafe commands', () => {
    const summary = read([
      prompt('Go'),
      tool('e1', 'Edit', { file_path: '/r/a', old_string: 'a', new_string: 'b' }),
      result('e1', 'String not found', 1, true),
      tool('e2', 'Write', { file_path: '/r/b', content: 'x' }),
      result('e2', DENIAL, 2, true, 'User rejected tool use'),
      tool('e3', 'Edit', { file_path: '/r/pending', old_string: 'a', new_string: 'b' }),
      bash('b1', 'rm -f a.txt', 'Remove', 3),
      result('b1', 'Exit code 1', 4, true),
      bash('b2', 'rm *.log && rm $FILE && rm "$(ls)" && rm ~/x && git rm --cached k', 'Glob', 5),
      result('b2', '', 6),
      bash('b3', 'mv a b c', 'Three', 7),
      result('b3', '', 8),
      bash('b4', 'npm run x', 'Other', 9),
      result('b4', '', 10)
    ])
    expect(summary.changes).toBeUndefined()
  })

  it('reads rm, git rm, mv and git mv steps, with flags, relative to the entry cwd', () => {
    const summary = read([
      prompt('Clean'),
      {
        ...bash('b', 'cd sub && rm -rf build out.txt; git rm -f old.ts || mv a.ts b.ts', 'X', 1),
        cwd: '/repo'
      },
      result('b', '', 2),
      bash('c', "mv 'one two.md' ../three.md", 'Y', 3),
      result('c', '', 4)
    ])
    expect(summary.changes?.map((c) => [c.kind, c.path, c.to])).toEqual([
      ['delete', '/repo/sub/build', undefined],
      ['delete', '/repo/sub/out.txt', undefined],
      ['delete', '/repo/sub/old.ts', undefined],
      ['rename', '/repo/sub/a.ts', '/repo/sub/b.ts'],
      ['rename', 'one two.md', '../three.md']
    ])
  })

  it('counts MultiEdit and NotebookEdit, a Write that replaced a file, and sizes from strings', () => {
    const summary = read([
      prompt('Go'),
      tool('m', 'MultiEdit', {
        file_path: '/r/m.ts',
        edits: [
          { old_string: 'a\nb\nc', new_string: 'a\nB\nc' },
          { old_string: 'x', new_string: 'x\ny' }
        ]
      }),
      result('m', 'ok', 1),
      tool('n', 'NotebookEdit', {
        notebook_path: '/r/n.ipynb',
        new_source: 'p\nq',
        edit_mode: 'insert'
      }),
      result('n', 'ok', 2),
      tool('w', 'Write', { file_path: '/r/w.ts', content: 'one\ntwo\n' }),
      result('w', 'ok', 3, false, {
        type: 'update',
        structuredPatch: [{ lines: ['-old', '+one', '+two'] }]
      })
    ])
    expect(summary.changes?.map((c) => [c.kind, c.path, c.added, c.removed])).toEqual([
      ['edit', '/r/m.ts', 2, 1],
      ['edit', '/r/n.ipynb', 2, 0],
      ['edit', '/r/w.ts', 2, 1]
    ])
  })

  it("gives a subagent's changes to the prompt its Task ran in", () => {
    const state = newTranscriptState()
    read(
      [
        prompt('First', 0),
        task('task1', { subagent_type: 'general', description: 'D', prompt: 'Do it' }, 1),
        prompt('Second', 10)
      ],
      state
    )
    addSubagentLine(state, 'agent-a1', sub(subPrompt('Do it', 2)))
    addSubagentLine(
      state,
      'agent-a1',
      sub(tool('s1', 'Write', { file_path: '/r/s.ts', content: 'x' }, 3))
    )
    addSubagentLine(state, 'agent-a1', sub(result('s1', 'ok', 4)))
    expect(agentSummary(state).changes).toEqual([
      { prompt: 1, kind: 'new', path: '/r/s.ts', added: 1, removed: 0 }
    ])
  })

  it('drops a change whose path is longer than 4,096 characters, never cutting it (D11)', () => {
    const long = `/r/${'d'.repeat(SUMMARY_LIMITS.path)}`
    const fits = `/${'f'.repeat(SUMMARY_LIMITS.path - 1)}`
    const summary = read([
      prompt('p'),
      tool('w1', 'Write', { file_path: long, content: 'x' }),
      result('w1', 'ok'),
      tool('w2', 'Edit', { file_path: fits, old_string: 'a', new_string: 'b' }),
      result('w2', 'ok'),
      bash('m1', `mv a.txt ${long}`),
      result('m1', ''),
      bash('m2', `rm ${long}`),
      result('m2', ''),
      bash('m3', 'rm /r/kept.txt'),
      result('m3', '')
    ])
    expect(summary.changes?.map((c) => [c.kind, c.path.length])).toEqual([
      ['edit', SUMMARY_LIMITS.path],
      ['delete', '/r/kept.txt'.length]
    ])
  })

  it('caps the prompt at 2,000 characters, the reply at 4,000 and the changes at 5,000 (D11)', () => {
    const entries: Entry[] = [prompt('p'.repeat(3000))]
    for (let i = 0; i < SUMMARY_LIMITS.changes + 3; i++) {
      entries.push(tool(`w${i}`, 'Write', { file_path: `/r/${i}`, content: 'x' }))
      entries.push(result(`w${i}`, 'ok'))
    }
    entries.push(reply('r'.repeat(5000)))
    const summary = read(entries)
    expect(summary.prompts?.[0].text).toHaveLength(SUMMARY_LIMITS.prompt)
    expect(summary.prompts?.[0].reply).toHaveLength(SUMMARY_LIMITS.reply)
    expect(summary.changes).toHaveLength(SUMMARY_LIMITS.changes)
    expect(summary.changes?.[0].path).toBe('/r/3')
  })
})
