import { describe, expect, it } from 'vitest'
import { cardStatus, knownRunState, knownStatus, lastOutputLine, statusLabel } from './card-status'

describe('lastOutputLine (D9)', () => {
  it('returns the last non-blank line at or above the cursor, trimmed', () => {
    const screen = ['$ printf hi', '  drovr-marker  ', '', '   ', 'below the cursor']
    expect(lastOutputLine(screen, 3)).toBe('drovr-marker')
    expect(lastOutputLine(screen, 1)).toBe('drovr-marker')
    expect(lastOutputLine(screen, 0)).toBe('$ printf hi')
  })
  it('removes escape sequences and treats a line of only escapes as blank', () => {
    const screen = [
      '\x1b[1;32muser@host\x1b[0m:\x1b[34m~/api\x1b[0m$ ',
      '\x1b]0;window title\x07\x1b[K',
      '\x1b]8;;http://x\x1b\\\x1b(B\x1b[?25h  '
    ]
    expect(lastOutputLine(screen, 2)).toBe('user@host:~/api$')
  })

  it('is empty when there is no output, and clamps the cursor row', () => {
    expect(lastOutputLine([], 0)).toBe('')
    expect(lastOutputLine(['', '  '], 1)).toBe('')
    expect(lastOutputLine(['a', 'b'], 9)).toBe('b')
    expect(lastOutputLine(['a', 'b'], -1)).toBe('')
  })
})

describe('statusLabel (D9)', () => {
  it('labels running, stopped (#5 D6) and failed to start', () => {
    expect(statusLabel({ kind: 'running' })).toBe('Running')
    expect(statusLabel({ kind: 'stopped' })).toBe('Stopped')
    expect(statusLabel({ kind: 'failed', reason: 'working directory not found' })).toBe(
      "Couldn't start: working directory not found"
    )
  })
})

describe('SSH failed (#12 D7)', () => {
  it('labels a Stopped SSH card whose ssh failed with its last output line', () => {
    expect(statusLabel({ kind: 'stopped', sshFailed: 'ssh: Could not resolve hostname x' })).toBe(
      'SSH failed: ssh: Could not resolve hostname x'
    )
    expect(cardStatus({ kind: 'stopped', sshFailed: 'Permission denied' }, 'ignored')).toEqual({
      label: 'SSH failed: Permission denied',
      agentStatus: '',
      lastLine: ''
    })
  })

  it('falls back to the exit code when there was no output', () => {
    expect(statusLabel({ kind: 'stopped', sshFailed: '' })).toBe('SSH failed: exit code 255')
  })
})

describe('cardStatus (D9)', () => {
  it('pairs the label with the last output line, except when stopped or it could not start', () => {
    expect(cardStatus({ kind: 'running' }, 'drovr-marker')).toEqual({
      label: 'Running',
      agentStatus: '',
      lastLine: 'drovr-marker'
    })
    expect(cardStatus({ kind: 'stopped' }, '$ exit 3')).toEqual({
      label: 'Stopped',
      agentStatus: '',
      lastLine: ''
    })
    expect(cardStatus({ kind: 'failed', reason: 'boom' }, 'stale')).toEqual({
      label: "Couldn't start: boom",
      agentStatus: '',
      lastLine: ''
    })
  })
})

describe('cardStatus with an agent status (#9 D8, #31 D11)', () => {
  it('shows the agent status and the last output line separately while running', () => {
    expect(cardStatus({ kind: 'running' }, '$ make', 'running tests')).toEqual({
      label: 'Running',
      agentStatus: 'running tests',
      lastLine: '$ make'
    })
  })

  it('has no agent status when it is empty', () => {
    expect(cardStatus({ kind: 'running' }, '$ make', '')).toEqual({
      label: 'Running',
      agentStatus: '',
      lastLine: '$ make'
    })
  })

  it('shows no text when the card is not running', () => {
    expect(cardStatus({ kind: 'stopped' }, '$ make', 'running tests')).toEqual({
      label: 'Stopped',
      agentStatus: '',
      lastLine: ''
    })
    expect(cardStatus({ kind: 'failed', reason: 'boom' }, '', 'running tests')).toEqual({
      label: "Couldn't start: boom",
      agentStatus: '',
      lastLine: ''
    })
  })
})

describe('cards the registry does not know (#8 D9)', () => {
  it('are Stopped, with no last line', () => {
    expect(knownRunState(undefined)).toEqual({ kind: 'stopped' })
    expect(knownStatus(undefined)).toEqual({ label: 'Stopped', agentStatus: '', lastLine: '' })
  })

  it('return the same objects every time, for useSyncExternalStore', () => {
    expect(knownRunState(undefined)).toBe(knownRunState(undefined))
    expect(knownStatus(undefined)).toBe(knownStatus(undefined))
  })

  it('leave a known card as it is', () => {
    const running = { kind: 'running' } as const
    const status = cardStatus(running, 'out')
    expect(knownRunState(running)).toBe(running)
    expect(knownStatus(status)).toBe(status)
  })
})
