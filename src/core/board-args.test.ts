import { describe, expect, it } from 'vitest'
import { BOARD_USAGE, parseBoardArgs } from './board-args'

describe('parseBoardArgs', () => {
  it('prints usage to stdout with exit 0 for no arguments, help and --help', () => {
    for (const argv of [[], ['help'], ['--help']]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'help', stdout: BOARD_USAGE, exitCode: 0 })
    }
  })

  it('parses a move', () => {
    expect(parseBoardArgs(['move', '.', 'Needs me'])).toEqual({
      kind: 'command',
      command: { command: 'move', card: '.', column: 'Needs me' }
    })
  })

  it('parses a status, keeping empty text', () => {
    expect(parseBoardArgs(['status', 'api', 'running tests'])).toEqual({
      kind: 'command',
      command: { command: 'status', card: 'api', text: 'running tests' }
    })
    expect(parseBoardArgs(['status', '.', ''])).toEqual({
      kind: 'command',
      command: { command: 'status', card: '.', text: '' }
    })
  })

  it('parses a session with a UUID, any case; anything else is usage', () => {
    expect(parseBoardArgs(['session', '.', '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11'])).toEqual({
      kind: 'command',
      command: { command: 'session', card: '.', session: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11' }
    })
    expect(parseBoardArgs(['session', '.', '6F1C1B1E-2F0E-4A59-9A43-0D6C4B0F1A11']).kind).toBe(
      'command'
    )
    for (const bad of ['x', '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11; rm -rf ~', '']) {
      expect(parseBoardArgs(['session', '.', bad]).kind).toBe('usage')
    }
  })

  it('parses an activity, each of working, waiting, question and none (#31 D12)', () => {
    for (const activity of ['working', 'waiting', 'question', 'none'] as const) {
      expect(parseBoardArgs(['activity', '.', activity])).toEqual({
        kind: 'command',
        command: { command: 'activity', card: '.', activity }
      })
    }
  })

  it('prints usage to stderr with exit 2 for any other activity (#31 D12)', () => {
    for (const argv of [
      ['activity', '.', 'busy'],
      ['activity', '.', 'Working'],
      ['activity', '.', ''],
      ['activity', '.'],
      ['activity', '.', 'working', 'x']
    ]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it('names the activity command in the usage text (#31 D12)', () => {
    expect(BOARD_USAGE).toContain('board activity <card> working|waiting|question|none')
  })

  it('prints usage to stderr with exit 2 for any other shape', () => {
    const shapes = [
      ['frob'],
      ['move'],
      ['move', '.'],
      ['move', '.', 'Done', 'extra'],
      ['status', '.'],
      ['status', '.', 'a', 'b'],
      ['help', 'me'],
      ['--help', 'x'],
      ['MOVE', '.', 'Done']
    ]
    for (const argv of shapes) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it('names both commands in the usage text', () => {
    expect(BOARD_USAGE).toContain('board move <card> <column>')
    expect(BOARD_USAGE).toContain('board status <card> <text>')
  })

  it('parses setup ok and failed; anything else is usage (#39 D4)', () => {
    for (const result of ['ok', 'failed'] as const) {
      expect(parseBoardArgs(['setup', '.', result])).toEqual({
        kind: 'command',
        command: { command: 'setup', card: '.', result }
      })
    }
    for (const argv of [
      ['setup', '.', 'OK'],
      ['setup', '.'],
      ['setup', '.', 'ok', 'x']
    ]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it("keeps setup out of the usage text: it is Bikube's own plumbing (#39 D4)", () => {
    expect(BOARD_USAGE).not.toContain('setup')
  })

  it('parses usage with a card and a transcript path to read; any other shape is usage (#50 D5)', () => {
    expect(parseBoardArgs(['usage', '.', '/tmp/x y/t.jsonl'])).toEqual({
      kind: 'transcript',
      card: '.',
      path: '/tmp/x y/t.jsonl'
    })
    for (const argv of [['usage', '.'], ['usage'], ['usage', '.', 't.jsonl', 'x']]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it("keeps usage out of the usage text: Bikube's hooks run it (#50 D5)", () => {
    expect(BOARD_USAGE).not.toMatch(/board usage/)
    expect(BOARD_USAGE).not.toMatch(/^ +usage\b/m)
  })

  it('parses list, list --json, create and rename', () => {
    expect(parseBoardArgs(['list'])).toEqual({
      kind: 'command',
      command: { command: 'list', format: 'text' }
    })
    expect(parseBoardArgs(['list', '--json'])).toEqual({
      kind: 'command',
      command: { command: 'list', format: 'json' }
    })
    expect(parseBoardArgs(['create', 'Backlog', 'Fix login'])).toEqual({
      kind: 'command',
      command: { command: 'create', column: 'Backlog', title: 'Fix login' }
    })
    expect(parseBoardArgs(['rename', '.', 'New title'])).toEqual({
      kind: 'command',
      command: { command: 'rename', card: '.', title: 'New title' }
    })
    for (const argv of [
      ['list', 'x'],
      ['list', '--json', 'x'],
      ['create', 'Backlog'],
      ['rename', '.']
    ]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it('parses description and describe with a file to read, - for stdin (#69 D5)', () => {
    expect(parseBoardArgs(['description', '.'])).toEqual({
      kind: 'command',
      command: { command: 'description', card: '.' }
    })
    expect(parseBoardArgs(['describe', 'api', '/tmp/x y/task.md'])).toEqual({
      kind: 'descriptionFile',
      card: 'api',
      path: '/tmp/x y/task.md'
    })
    expect(parseBoardArgs(['describe', '.', '-'])).toEqual({
      kind: 'descriptionFile',
      card: '.',
      path: '-'
    })
    for (const argv of [
      ['description'],
      ['description', '.', 'x'],
      ['describe', '.'],
      ['describe', '.', 'a', 'b']
    ]) {
      expect(parseBoardArgs(argv)).toEqual({ kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 })
    }
  })

  it('names description and describe in the usage text (#69 D5)', () => {
    expect(BOARD_USAGE).toContain('board description <card>')
    expect(BOARD_USAGE).toContain('board describe <card> <file>|-')
  })
})

describe('parseBoardArgs across workspaces (#69 D6–D8)', () => {
  const usage = { kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 }

  it('parses workspaces and workspaces --json; anything more is usage (D6)', () => {
    expect(parseBoardArgs(['workspaces'])).toEqual({
      kind: 'command',
      command: { command: 'workspaces', format: 'text' }
    })
    expect(parseBoardArgs(['workspaces', '--json'])).toEqual({
      kind: 'command',
      command: { command: 'workspaces', format: 'json' }
    })
    for (const argv of [
      ['workspaces', 'x'],
      ['workspaces', '--workspace', 'a']
    ]) {
      expect(parseBoardArgs(argv)).toEqual(usage)
    }
  })

  it('takes --workspace on list, create, rename, move, status, description and describe (D6)', () => {
    expect(parseBoardArgs(['list', '--workspace', 'Beta', '--json'])).toEqual({
      kind: 'command',
      command: { command: 'list', format: 'json', workspace: 'Beta' }
    })
    expect(parseBoardArgs(['rename', 'Port Y', 'Z', '--workspace', 'Beta'])).toEqual({
      kind: 'command',
      command: { command: 'rename', card: 'Port Y', title: 'Z', workspace: 'Beta' }
    })
    expect(parseBoardArgs(['move', '--workspace', 'b', 'x', 'Done'])).toEqual({
      kind: 'command',
      command: { command: 'move', card: 'x', column: 'Done', workspace: 'b' }
    })
    expect(parseBoardArgs(['status', '--workspace', 'b', 'x', 'queued'])).toEqual({
      kind: 'command',
      command: { command: 'status', card: 'x', text: 'queued', workspace: 'b' }
    })
    expect(parseBoardArgs(['description', '--workspace', 'b', 'x'])).toEqual({
      kind: 'command',
      command: { command: 'description', card: 'x', workspace: 'b' }
    })
    expect(parseBoardArgs(['describe', '--workspace', 'b', 'x', '-'])).toEqual({
      kind: 'descriptionFile',
      card: 'x',
      path: '-',
      workspace: 'b'
    })
    for (const argv of [
      ['list', '--workspace'],
      ['list', '--workspace', 'a', '--workspace', 'b'],
      ['activity', '--workspace', 'b', '.', 'working'],
      ['session', '--workspace', 'b', '.', '0b5e1c9a-3f0e-4d4a-9a39-6b2f0e8c1d2e'],
      ['setup', '--workspace', 'b', '.', 'ok'],
      ['usage', '--workspace', 'b', '.', '/tmp/t.jsonl']
    ]) {
      expect(parseBoardArgs(argv)).toEqual(usage)
    }
  })

  it("parses create's --agent and --description-file, - for stdin (D8)", () => {
    expect(
      parseBoardArgs([
        'create',
        '--workspace',
        'beta',
        '--agent',
        'gemini',
        '--description-file',
        '-',
        'Todo',
        'Port X'
      ])
    ).toEqual({
      kind: 'createWithDescription',
      path: '-',
      command: {
        command: 'create',
        column: 'Todo',
        title: 'Port X',
        workspace: 'beta',
        agent: 'gemini'
      }
    })
    for (const agent of ['claude', 'codex', 'gemini', 'opencode', 'pi', 'shell']) {
      expect(parseBoardArgs(['create', '--agent', agent, 'Todo', 'T1'])).toEqual({
        kind: 'command',
        command: { command: 'create', column: 'Todo', title: 'T1', agent }
      })
    }
    for (const argv of [
      ['create', '--agent', 'vim', 'Todo', 'T1'],
      ['create', '--agent', 'Todo', 'T1'],
      ['create', '--description-file', 'Todo', 'T1'],
      ['rename', '--agent', 'codex', '.', 'T1']
    ]) {
      expect(parseBoardArgs(argv)).toEqual(usage)
    }
  })

  it('takes -- as the end of the options, so a title may start with --', () => {
    expect(parseBoardArgs(['rename', '--', '.', '--workspace'])).toEqual({
      kind: 'command',
      command: { command: 'rename', card: '.', title: '--workspace' }
    })
  })

  it('names workspaces, --workspace, --agent and --description-file in the usage text', () => {
    expect(BOARD_USAGE).toContain('board workspaces [--json]')
    expect(BOARD_USAGE).toContain('--workspace <w>')
    expect(BOARD_USAGE).toContain('--agent <agent>')
    expect(BOARD_USAGE).toContain('--description-file <file>|-')
  })
})

describe('parseBoardArgs: create --worktree (#69 D10)', () => {
  const usage = { kind: 'usage', stderr: BOARD_USAGE, exitCode: 2 }

  it('parses --worktree alone and with --branch, anywhere before --', () => {
    expect(parseBoardArgs(['create', '--worktree', 'Todo', 'Port X'])).toEqual({
      kind: 'command',
      command: { command: 'create', column: 'Todo', title: 'Port X', worktree: true }
    })
    expect(
      parseBoardArgs([
        'create',
        '--workspace',
        'Beta',
        'Todo',
        '--branch',
        'port-x',
        '--worktree',
        'Port X'
      ])
    ).toEqual({
      kind: 'command',
      command: {
        command: 'create',
        column: 'Todo',
        title: 'Port X',
        workspace: 'Beta',
        worktree: true,
        branch: 'port-x'
      }
    })
    expect(
      parseBoardArgs(['create', '--worktree', '--description-file', '-', 'Todo', 'Port X'])
    ).toEqual({
      kind: 'createWithDescription',
      path: '-',
      command: { command: 'create', column: 'Todo', title: 'Port X', worktree: true }
    })
  })

  it('refuses --branch without --worktree, a repeated or valueless one, and both on other commands', () => {
    for (const argv of [
      ['create', '--branch', 'x', 'Todo', 'T1'],
      ['create', '--worktree', '--worktree', 'Todo', 'T1'],
      ['create', '--worktree', '--branch', 'a', '--branch', 'b', 'Todo', 'T1'],
      ['create', '--worktree', 'Todo', 'T1', '--branch'],
      ['rename', '--worktree', '.', 'T1'],
      ['move', '--branch', 'x', '.', 'Todo']
    ]) {
      expect(parseBoardArgs(argv)).toEqual(usage)
    }
  })

  it('names --worktree [--branch <name>] in the usage text', () => {
    expect(BOARD_USAGE).toContain('[--worktree [--branch <name>]]')
  })
})
