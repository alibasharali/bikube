import { describe, expect, it } from 'vitest'
import {
  cardPill,
  cardStatus,
  knownRunState,
  knownStatus,
  isShellExitLine,
  lastOutputLine,
  outputTail,
  statusLabel
} from './card-status'

describe('outputTail', () => {
  it('keeps the last lines at or above the cursor, indentation kept, the exit line and edges dropped', () => {
    const lines = [
      '',
      '$ make',
      '\x1b[31mmake: *** [all] Error 1\x1b[0m',
      '  at a.c:3   ',
      '',
      'exit',
      '',
      'below'
    ]
    expect(outputTail(lines, 6, null, isShellExitLine)).toEqual([
      '$ make',
      'make: *** [all] Error 1',
      '  at a.c:3'
    ])
  })

  it('keeps at most the given number of lines, the newest', () => {
    expect(outputTail(['a', 'b', 'c', 'd'], 3, null, undefined, 2)).toEqual(['c', 'd'])
    expect(outputTail(['', ' '], 1, null)).toEqual([])
  })

  it('starts after the typed line, also wrapped over rows, and keeps one blank row of a run', () => {
    const lines = [
      'Welcome banner',
      'host % npm run bu',
      'ild; exit',
      'step 1',
      '',
      '',
      'Error: boom',
      'exit'
    ]
    expect(outputTail(lines, 7, 'npm run build; exit', isShellExitLine)).toEqual([
      'step 1',
      '',
      'Error: boom'
    ])
    // A command that printed nothing keeps nothing, never the banner above it.
    expect(
      outputTail(['banner', 'host % false; exit', 'exit'], 2, 'false; exit', isShellExitLine)
    ).toEqual([])
  })
})

describe('lastOutputLine (D9)', () => {
  it('returns the last non-blank line at or above the cursor, trimmed', () => {
    const screen = ['$ printf hi', '  bikube-marker  ', '', '   ', 'below the cursor']
    expect(lastOutputLine(screen, 3)).toBe('bikube-marker')
    expect(lastOutputLine(screen, 1)).toBe('bikube-marker')
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

  it("drops Nerd Font icons and Powerline separators, keeping the prompt's text", () => {
    // A starship prompt as the screen holds it: icons and separators from the Private Use Area.
    const prompt =
      '\ue0b6\uf179 aliali\ue0b0 \uf07c /\ue0b0\ue0b0\ue0b0\ue0b0 \u{f0954} 22:48 \ue0b4 \u276f'
    expect(lastOutputLine([prompt], 0)).toBe('aliali / 22:48 \u276f')
    // A line of only glyphs counts as blank; other symbols and emoji stay.
    expect(lastOutputLine(['\u2713 128 passed \ud83d\ude80', '\ue0b0\ue0b4'], 1)).toBe(
      '\u2713 128 passed \ud83d\ude80'
    )
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
    expect(cardStatus({ kind: 'running' }, 'bikube-marker')).toEqual({
      label: 'Running',
      agentStatus: '',
      lastLine: 'bikube-marker'
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

describe('cardPill (#31 D13, #39 D5)', () => {
  const running = { kind: 'running' } as const
  it('is the activity, or none', () => {
    expect(cardPill(cardStatus(running, ''))).toBeNull()
    expect(cardPill(cardStatus(running, '', '', 'waiting'))).toEqual({
      kind: 'waiting',
      label: 'Waiting for you'
    })
  })

  it('shows the setup state in place of any activity', () => {
    expect(cardPill(cardStatus(running, '', '', 'working', 'running'))).toEqual({
      kind: 'setup-running',
      label: 'Setting up'
    })
    expect(cardPill(cardStatus(running, '', '', null, 'failed'))).toEqual({
      kind: 'setup-failed',
      label: 'Setup failed'
    })
  })

  it('a card that is not running has no setup', () => {
    expect(cardStatus({ kind: 'stopped' }, '', '', null, 'failed').setup).toBeUndefined()
  })
})
