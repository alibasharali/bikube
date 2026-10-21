import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_INSTRUCTION,
  LOCAL_CLAUDE_INSTRUCTION,
  CLAUDE_INSTRUCTION_FILE,
  CLAUDE_SETTINGS_FILE,
  claudeSettings
} from './claude-hooks'

interface Hook {
  type: string
  command: string
  timeout: number
}
interface HookGroup {
  matcher?: string
  hooks: Hook[]
}
type Settings = { hooks: Record<string, HookGroup[]> }

const settings = (): Settings => JSON.parse(claudeSettings()) as Settings

/** The one command of `event`'s one group. */
function command(event: string): string {
  const groups = settings().hooks[event]
  expect(groups).toHaveLength(1)
  expect(groups[0].hooks).toHaveLength(1)
  return groups[0].hooks[0].command
}

describe('the Claude settings file (#31 D15)', () => {
  it('holds only hooks, one command each with a 5 s timeout, for the five events', () => {
    const parsed = settings()
    expect(Object.keys(parsed)).toEqual(['hooks'])
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['Notification', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort()
    )
    for (const groups of Object.values(parsed.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook).toEqual({ type: 'command', command: hook.command, timeout: 5 })
        }
      }
    }
  })

  it('runs on every tool, and on permission prompts and input requests but not the idle reminder', () => {
    expect(settings().hooks.PreToolUse[0].matcher).toBe('*')
    expect(settings().hooks.Notification[0].matcher).toBe('permission_prompt|elicitation_dialog')
    for (const event of ['UserPromptSubmit', 'Stop', 'SessionStart']) {
      expect(settings().hooks[event][0].matcher).toBeUndefined()
    }
  })

  it('ships in the bin directory beside board, with the instruction (D14, D16)', () => {
    const bin = join(__dirname, '..', '..', 'resources', 'bin')
    expect(readFileSync(join(bin, CLAUDE_SETTINGS_FILE), 'utf8')).toBe(claudeSettings())
    expect(readFileSync(join(bin, CLAUDE_INSTRUCTION_FILE), 'utf8')).toBe(
      `${LOCAL_CLAUDE_INSTRUCTION}\n`
    )
  })

  it('tells local cards how to read the board and create cards', () => {
    expect(LOCAL_CLAUDE_INSTRUCTION.startsWith(`${CLAUDE_INSTRUCTION} `)).toBe(true)
    expect(LOCAL_CLAUDE_INSTRUCTION).toContain('"$DROVR_BIN/board" list --json')
    expect(LOCAL_CLAUDE_INSTRUCTION).toContain('"$DROVR_BIN/board" create <column> <title>')
  })

  it('gives Claude the D16 instruction, with no backslash so the SSH copy stays fish-safe', () => {
    expect(CLAUDE_INSTRUCTION).toBe(
      'You are running inside a Drovr card, a kanban board card that shows your status. ' +
        `At the end of every turn, run exactly: "$DROVR_BIN/board" status . '<one line>' — one ` +
        'short line, at most 80 characters, saying what you did or what you are waiting for, for ' +
        'example: Tests green, PR ready for review. Run that command alone, as written: add ' +
        'nothing before or after it (no redirection, no || true, no ; or true). Do it silently: ' +
        "don't mention it to the user. If it fails, ignore it and move on."
    )
    expect(CLAUDE_INSTRUCTION).not.toContain('\\')
  })
})

describe('the hook commands, run by a shell (#31 D15, AC13)', () => {
  let dir: string
  let bin: string
  let log: string
  let usageLog: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drovr-hooks-'))
    // A bin directory with a space, a fake board that logs its arguments, talks and fails.
    bin = join(dir, 'my bin')
    execFileSync('mkdir', [bin])
    log = join(dir, 'board.log')
    // `board usage` (#50 D6) logs to its own file, so the activity and session log stays as it was.
    usageLog = join(dir, 'usage.log')
    writeFileSync(
      join(bin, 'board'),
      `#!/bin/sh\nsleep "\${FAKE_BOARD_SLEEP:-0}"\n` +
        `case $1 in usage) echo "$*" >> '${usageLog}';; *) echo "$*" >> '${log}';; esac\n` +
        `echo noise; echo oops >&2\nexit "\${FAKE_BOARD_EXIT:-0}"\n`
    )
    chmodSync(join(bin, 'board'), 0o755)
    writeFileSync(join(bin, CLAUDE_INSTRUCTION_FILE), `${CLAUDE_INSTRUCTION}\n`)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const logged = (): string[] => {
    try {
      return readFileSync(log, 'utf8').split('\n').slice(0, -1)
    } catch {
      return []
    }
  }

  /** The log once it has `count` lines; PreToolUse runs `board` in the background (round 4 Q5). */
  const loggedLines = (count: number): string[] => {
    const until = Date.now() + 5000
    while (logged().length < count && Date.now() < until) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
    return logged()
  }

  /** Runs `event`'s command with `input` on stdin, like Claude Code does. */
  function run(
    shell: string,
    event: string,
    input: object,
    env: Record<string, string> = {}
  ): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(shell, ['-c', command(event)], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', DROVR_BIN: bin, ...env }
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  const base = { session_id: 's', transcript_path: '/t', cwd: '/w' }
  const samples: [string, object, string | null][] = [
    ['UserPromptSubmit', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 'working'],
    [
      'PreToolUse',
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
      'working'
    ],
    [
      'PreToolUse',
      {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Which?' }] }
      },
      'question'
    ],
    [
      'Notification',
      {
        ...base,
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash'
      },
      'question'
    ],
    ['Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false }, 'waiting']
  ]

  for (const shell of ['/bin/sh', '/bin/bash']) {
    it(`sets the calling card's activity, silently, exit 0 (${shell})`, () => {
      let lines = 0
      for (const [event, input, activity] of samples) {
        expect(run(shell, event, input)).toEqual({ status: 0, stdout: '', stderr: '' })
        // A message sent also reports the session (below), first.
        lines += event === 'UserPromptSubmit' ? 2 : 1
        expect(loggedLines(lines).at(-1)).toBe(`activity . ${activity}`)
      }
      expect(logged()).toHaveLength(lines)
    })

    it(`reports the session on a message and on a /resume, not on a fresh start (${shell})`, () => {
      const id = '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11'
      run(shell, 'UserPromptSubmit', { ...base, session_id: id, prompt: 'hi' })
      expect(loggedLines(2)).toEqual([`session . ${id}`, 'activity . working'])
      run(shell, 'SessionStart', { ...base, session_id: id, source: 'startup' })
      expect(logged()).toHaveLength(2)
      // A /resume, in Claude's spaced JSON too.
      const resumed = 'aaaaaaaa-2f0e-4a59-9a43-0d6c4b0f1a11'
      const spaced = JSON.stringify({ ...base, session_id: resumed, source: 'resume' }, null, 1)
      expect(
        spawnSync(shell, ['-c', command('SessionStart')], {
          input: spaced,
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', DROVR_BIN: bin }
        }).status
      ).toBe(0)
      expect(loggedLines(3).at(-1)).toBe(`session . ${resumed}`)
    })

    it(`exits 0 when board fails or is missing (${shell})`, () => {
      for (const [event, input] of samples) {
        expect(run(shell, event, input, { FAKE_BOARD_EXIT: '1' }).status).toBe(0)
        expect(run(shell, event, input, { DROVR_BIN: join(dir, 'nowhere') })).toEqual({
          status: 0,
          stdout: '',
          stderr: ''
        })
      }
    })

    it(`prints the instruction at session start and sets nothing (${shell})`, () => {
      const input = { ...base, hook_event_name: 'SessionStart', source: 'startup' }
      expect(run(shell, 'SessionStart', input)).toEqual({
        status: 0,
        stdout: `${CLAUDE_INSTRUCTION}\n`,
        stderr: ''
      })
      expect(logged()).toEqual([])
      expect(run(shell, 'SessionStart', input, { DROVR_BIN: join(dir, 'nowhere') })).toEqual({
        status: 0,
        stdout: '',
        stderr: ''
      })
    })

    it(`prints nothing at session start with status updates off (${shell})`, () => {
      const input = { ...base, hook_event_name: 'SessionStart', source: 'startup' }
      expect(run(shell, 'SessionStart', input, { DROVR_CLAUDE_STATUS: '0' })).toEqual({
        status: 0,
        stdout: '',
        stderr: ''
      })
      expect(run(shell, 'SessionStart', input, { DROVR_CLAUDE_STATUS: '1' }).stdout).toBe(
        `${CLAUDE_INSTRUCTION}\n`
      )
    })
  }

  /** The usage log once it has `count` lines: `board usage` runs in the background (#50 D6). */
  const usageLines = (count: number): string[] => {
    const read = (): string[] => {
      try {
        return readFileSync(usageLog, 'utf8').split('\n').slice(0, -1)
      } catch {
        return []
      }
    }
    const until = Date.now() + 5000
    while (read().length < count && Date.now() < until) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
    return read()
  }

  describe('report the transcript with board usage at Stop and SessionStart (#50 D6, AC6)', () => {
    const transcript = { session_id: 's', transcript_path: '/tmp/x y/t.jsonl', cwd: '/w' }

    it('has no backslash in either command, and nothing on PreToolUse', () => {
      expect(command('Stop')).not.toContain('\\')
      expect(command('SessionStart')).not.toContain('\\')
      expect(command('PreToolUse')).not.toContain('usage')
    })

    it('reports the transcript at Stop, still setting waiting', () => {
      const input = { ...transcript, hook_event_name: 'Stop', stop_hook_active: false }
      expect(run('/bin/sh', 'Stop', input)).toEqual({ status: 0, stdout: '', stderr: '' })
      expect(usageLines(1)).toEqual(['usage . /tmp/x y/t.jsonl'])
      expect(loggedLines(1)).toEqual(['activity . waiting'])
    })

    /** An existing transcript in the test's folder, its path with a space. */
    const existing = (): string => {
      const path = join(dir, 'x y', 't.jsonl')
      mkdirSync(join(dir, 'x y'))
      writeFileSync(path, '')
      return path
    }

    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      it(`reports the transcript at SessionStart (${source}), still printing the instruction`, () => {
        const path = existing()
        const input = {
          ...transcript,
          transcript_path: path,
          hook_event_name: 'SessionStart',
          source
        }
        expect(run('/bin/sh', 'SessionStart', input)).toEqual({
          status: 0,
          stdout: `${CLAUDE_INSTRUCTION}\n`,
          stderr: ''
        })
        expect(usageLines(1)).toEqual([`usage . ${path}`])
      })
    }

    it("reports a transcript that doesn't exist yet at SessionStart as /dev/null, so /clear clears", () => {
      const input = { ...transcript, hook_event_name: 'SessionStart', source: 'clear' }
      expect(run('/bin/sh', 'SessionStart', input).status).toBe(0)
      expect(usageLines(1)).toEqual(['usage . /dev/null'])
    })

    it("reads Claude's spaced JSON too", () => {
      const spaced = JSON.stringify({ ...transcript, hook_event_name: 'Stop' }, null, 1)
      expect(
        spawnSync('/bin/sh', ['-c', command('Stop')], {
          input: spaced,
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', DROVR_BIN: bin }
        }).status
      ).toBe(0)
      expect(usageLines(1)).toEqual(['usage . /tmp/x y/t.jsonl'])
    })

    it('runs no board usage without a transcript path', () => {
      expect(run('/bin/sh', 'Stop', { session_id: 's', hook_event_name: 'Stop' }).status).toBe(0)
      expect(loggedLines(1)).toEqual(['activity . waiting'])
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
      expect(usageLines(0)).toEqual([])
    })

    it("returns before board usage finishes, so Claude doesn't wait", () => {
      const path = existing()
      const input = {
        ...transcript,
        transcript_path: path,
        hook_event_name: 'SessionStart',
        source: 'startup'
      }
      const start = Date.now()
      expect(run('/bin/sh', 'SessionStart', input, { FAKE_BOARD_SLEEP: '2' }).status).toBe(0)
      expect(Date.now() - start).toBeLessThan(1500)
      expect(usageLines(1)).toEqual([`usage . ${path}`])
    })
  })

  it('reads a question only from the tool name, not from what a tool is given', () => {
    const input = {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo AskUserQuestion "tool_name": "AskUserQuestion"' }
    }
    expect(run('/bin/sh', 'PreToolUse', input).status).toBe(0)
    expect(loggedLines(1)).toEqual(['activity . working'])
  })

  it("returns before board finishes in PreToolUse, so Claude doesn't wait (round 4 Q5)", () => {
    const input = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }
    const start = Date.now()
    expect(run('/bin/sh', 'PreToolUse', input, { FAKE_BOARD_SLEEP: '2' })).toEqual({
      status: 0,
      stdout: '',
      stderr: ''
    })
    expect(Date.now() - start).toBeLessThan(1500)
    expect(logged()).toEqual([])
    expect(loggedLines(1)).toEqual(['activity . working'])
  })
})
