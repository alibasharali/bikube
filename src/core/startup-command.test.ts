import { describe, expect, it } from 'vitest'
import { checkStartup, FIRST_PROMPT, startLine, typedStartLine } from './startup-command'

const U = '3f0e4c1a-8b2d-4c6e-9a7f-1b2c3d4e5f60'

describe('startLine (D2, D5)', () => {
  it('types nothing for a Shell card (AC1, AC6)', () => {
    expect(
      startLine({ startup: { kind: 'shell' }, agentSessionId: U, claudeStarted: false })
    ).toBeNull()
  })

  it("starts Claude Code with Bikube's settings and the session id, resuming it if it exists", () => {
    expect(
      startLine({ startup: { kind: 'claude' }, agentSessionId: U, claudeStarted: false })
    ).toBe(
      `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --session-id ${U} || ` +
        `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume ${U}`
    )
  })

  it('resumes, falling back to the same session id, once Claude was started (AC4, AC9, #31 D14)', () => {
    expect(startLine({ startup: { kind: 'claude' }, agentSessionId: U, claudeStarted: true })).toBe(
      `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume ${U} || ` +
        `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --session-id ${U}`
    )
  })

  it('types nothing for Claude Code when the session id is not a UUID', () => {
    for (const agentSessionId of ['', 'x; rm -rf ~', `${U} && echo hi`, `${U}\n`]) {
      for (const claudeStarted of [false, true]) {
        expect(startLine({ startup: { kind: 'claude' }, agentSessionId, claudeStarted })).toBeNull()
      }
    }
    expect(
      startLine({
        startup: { kind: 'claude' },
        agentSessionId: U.toUpperCase(),
        claudeStarted: false
      })
    ).toContain(`--session-id ${U.toUpperCase()} ||`)
  })

  it('types a Custom command as written (AC7)', () => {
    expect(
      startLine({
        startup: { kind: 'custom', command: 'echo bikube-custom' },
        agentSessionId: U,
        claudeStarted: true
      })
    ).toBe('echo bikube-custom')
  })

  it('follows a workspace shell’s command with `; exit` when it closes once the command ends', () => {
    expect(
      startLine({
        startup: { kind: 'custom', command: 'npm run dev' },
        agentSessionId: '',
        claudeStarted: false,
        exitAfterStartup: true
      })
    ).toBe('npm run dev; exit')
  })
})

describe('checkStartup (D2, AC7)', () => {
  it('passes Shell and Claude Code through', () => {
    expect(checkStartup({ kind: 'shell' })).toEqual({ ok: true, value: { kind: 'shell' } })
    expect(checkStartup({ kind: 'claude' })).toEqual({ ok: true, value: { kind: 'claude' } })
  })

  it('trims a Custom command', () => {
    expect(checkStartup({ kind: 'custom', command: '  codex resume --last ' })).toEqual({
      ok: true,
      value: { kind: 'custom', command: 'codex resume --last' }
    })
  })

  it('requires a Custom command', () => {
    for (const command of ['', '   ']) {
      expect(checkStartup({ kind: 'custom', command })).toEqual({
        ok: false,
        error: { field: 'command', message: 'Command is required' }
      })
    }
  })

  it('rejects a Custom command spanning several lines', () => {
    for (const command of ['echo a\necho b', 'echo a\recho b']) {
      expect(checkStartup({ kind: 'custom', command })).toEqual({
        ok: false,
        error: { field: 'command', message: 'Command must be one line' }
      })
    }
  })
})

describe('agent presets (#21 D1, D2)', () => {
  const presets = [
    ['codex', 'codex', 'codex resume --last'],
    ['gemini', 'gemini', 'gemini --resume latest'],
    ['opencode', 'opencode', 'opencode --continue'],
    ['pi', 'pi', 'pi --continue']
  ] as const

  it('types the plain command the first time a card starts a preset (AC1)', () => {
    for (const [kind, plain] of presets) {
      expect(
        startLine({ startup: { kind }, agentSessionId: U, claudeStarted: true, startedAgents: [] })
      ).toBe(plain)
    }
  })

  it('resumes, falling back to the plain command, once the preset was started (AC2, AC3)', () => {
    for (const [kind, plain, resume] of presets) {
      expect(
        startLine({
          startup: { kind },
          agentSessionId: U,
          claudeStarted: false,
          startedAgents: [kind]
        })
      ).toBe(`${resume} || ${plain}`)
    }
  })

  it("counts only the card's own preset as started (AC4)", () => {
    expect(
      startLine({
        startup: { kind: 'codex' },
        agentSessionId: U,
        claudeStarted: true,
        startedAgents: ['gemini', 'opencode']
      })
    ).toBe('codex')
  })

  it('passes the presets through checkStartup', () => {
    for (const [kind] of presets)
      expect(checkStartup({ kind })).toEqual({ ok: true, value: { kind } })
  })
})

describe('typedStartLine', () => {
  const clear = "printf '\\033[H\\033[2J'; "

  it("clears the screen before an agent's start line", () => {
    const claude = { startup: { kind: 'claude' }, agentSessionId: U, claudeStarted: false } as const
    expect(typedStartLine(claude)).toBe(clear + startLine(claude))
    const codex = { startup: { kind: 'codex' }, agentSessionId: U, claudeStarted: false } as const
    expect(typedStartLine(codex)).toBe(`${clear}codex`)
  })

  it('types a Custom command as written, and nothing for a Shell card', () => {
    const custom = {
      startup: { kind: 'custom', command: 'make' },
      agentSessionId: U,
      claudeStarted: false
    } as const
    expect(typedStartLine(custom)).toBe('make')
    expect(
      typedStartLine({ startup: { kind: 'shell' }, agentSessionId: U, claudeStarted: false })
    ).toBeNull()
  })
})

describe('the first prompt for a card with a description (#69 D2, AC2)', () => {
  const prompt =
    'This card has a task description. Read it with: board description .  Then summarise it in ' +
    'a few lines and ask me whether to start on it. Do not start working on it until I say so.'
  const described = { agentSessionId: U, description: '# Goal\nFix it' }

  it('is the fixed text, which holds no quote, backslash or $', () => {
    expect(FIRST_PROMPT).toBe(prompt)
    expect(FIRST_PROMPT).not.toMatch(/['"\\$`]/)
  })

  it("passes it on Claude Code's fresh start only, on the --session-id branch", () => {
    expect(startLine({ ...described, startup: { kind: 'claude' }, claudeStarted: false })).toBe(
      `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --session-id ${U} '${prompt}' || ` +
        `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume ${U}`
    )
    expect(startLine({ ...described, startup: { kind: 'claude' }, claudeStarted: true })).toBe(
      `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume ${U} || ` +
        `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --session-id ${U}`
    )
  })

  it("passes it to each preset's fresh start, never to its resume", () => {
    const fresh = [
      ['codex', `codex '${prompt}'`],
      ['gemini', `gemini -i '${prompt}'`],
      ['opencode', `opencode --prompt '${prompt}'`],
      ['pi', `pi '${prompt}'`]
    ] as const
    for (const [kind, line] of fresh) {
      const card = { ...described, startup: { kind }, claudeStarted: false }
      expect(startLine({ ...card, startedAgents: [] })).toBe(line)
      expect(startLine({ ...card, startedAgents: [kind] })).not.toContain(prompt)
    }
    expect(
      startLine({
        ...described,
        startup: { kind: 'codex' },
        claudeStarted: false,
        startedAgents: ['codex']
      })
    ).toBe('codex resume --last || codex')
  })

  it('never passes it to a Custom command or a shell', () => {
    const custom = { kind: 'custom', command: 'make' } as const
    expect(startLine({ ...described, startup: custom, claudeStarted: false })).toBe('make')
    expect(startLine({ ...described, startup: { kind: 'shell' }, claudeStarted: false })).toBeNull()
  })

  it('starts a card without a description as before', () => {
    expect(startLine({ agentSessionId: U, startup: { kind: 'codex' }, claudeStarted: false })).toBe(
      'codex'
    )
    expect(
      startLine({
        agentSessionId: U,
        description: undefined,
        startup: { kind: 'claude' },
        claudeStarted: false
      })
    ).not.toContain(prompt)
  })
})
