import { describe, expect, it } from 'vitest'
import { cardStatus, lastOutputLine, statusLabel } from './card-status'

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
  it('labels running, exited by code or signal, and failed to start', () => {
    expect(statusLabel({ kind: 'running' })).toBe('Running')
    expect(statusLabel({ kind: 'exited', exitCode: 3 })).toBe('Exited (code 3)')
    expect(statusLabel({ kind: 'exited', exitCode: 0, signal: 0 })).toBe('Exited (code 0)')
    expect(statusLabel({ kind: 'exited', exitCode: 0, signal: 15 })).toBe('Exited (signal 15)')
    expect(statusLabel({ kind: 'failed', reason: 'working directory not found' })).toBe(
      "Couldn't start: working directory not found"
    )
  })
})

describe('cardStatus (D9)', () => {
  it('pairs the label with the last output line, except when it could not start', () => {
    expect(cardStatus({ kind: 'running' }, 'drovr-marker')).toEqual({
      label: 'Running',
      lastLine: 'drovr-marker'
    })
    expect(cardStatus({ kind: 'exited', exitCode: 3 }, '$ exit 3')).toEqual({
      label: 'Exited (code 3)',
      lastLine: '$ exit 3'
    })
    expect(cardStatus({ kind: 'failed', reason: 'boom' }, 'stale')).toEqual({
      label: "Couldn't start: boom",
      lastLine: ''
    })
  })
})
