import { describe, expect, it } from 'vitest'
import { checkStartup, startLine } from './startup-command'

const U = '3f0e4c1a-8b2d-4c6e-9a7f-1b2c3d4e5f60'

describe('startLine (D2, D5)', () => {
  it('types nothing for a Shell card (AC1, AC6)', () => {
    expect(
      startLine({ startup: { kind: 'shell' }, agentSessionId: U, claudeStarted: false })
    ).toBeNull()
  })

  it('starts Claude Code with the session id the first time (AC2)', () => {
    expect(
      startLine({ startup: { kind: 'claude' }, agentSessionId: U, claudeStarted: false })
    ).toBe(`claude --session-id ${U}`)
  })

  it('resumes, falling back to the same session id, once Claude was started (AC4, AC9)', () => {
    expect(startLine({ startup: { kind: 'claude' }, agentSessionId: U, claudeStarted: true })).toBe(
      `claude --resume ${U} || claude --session-id ${U}`
    )
  })

  it('types a Custom command as written (AC7)', () => {
    expect(
      startLine({
        startup: { kind: 'custom', command: 'echo drovr-custom' },
        agentSessionId: U,
        claudeStarted: true
      })
    ).toBe('echo drovr-custom')
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
