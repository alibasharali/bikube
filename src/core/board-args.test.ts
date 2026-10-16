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
})
