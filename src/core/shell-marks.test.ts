import { describe, expect, it } from 'vitest'
import {
  parseShellMark,
  hostNameArg,
  parseHostName,
  ShellMarks,
  splitDirectory,
  type ShellCommand,
  type ShellMarkFamily
} from './shell-marks'

/** Feeds `sequences` (an OSC family and its payload) to a fresh mark state, one row each. */
function fed(sequences: [ShellMarkFamily, string][]): {
  marks: ShellMarks<number>
  ended: ShellCommand<number>[]
} {
  const marks = new ShellMarks<number>()
  const ended: ShellCommand<number>[] = []
  marks.onCommandEnded((command) => ended.push(command))
  sequences.forEach(([family, data], row) => {
    const mark = parseShellMark(family, data)
    if (mark) marks.feed(mark, 1000 + row, () => row)
  })
  return { marks, ended }
}

describe('ShellMarks (#45 D1, D2)', () => {
  it.each([133, 633] as const)(
    'AC1: A, B, C, D;2 through OSC %i make one command on the B row, exit code 2, timed',
    (family) => {
      const { marks, ended } = fed([
        [family, 'A'],
        [family, 'B'],
        [family, 'C'],
        [family, 'D;2']
      ])
      const command = { line: 1, start: 1002, end: 1003, exitCode: 2 }
      expect(marks.commands()).toEqual([command])
      expect(ended).toEqual([command])
    }
  )

  it('AC1: a D alone after a command ends nothing', () => {
    const { marks, ended } = fed([
      [133, 'A'],
      [133, 'B'],
      [133, 'C'],
      [133, 'D;2'],
      [133, 'A'],
      [133, 'B'],
      [133, 'D'],
      [133, 'D;5']
    ])
    expect(marks.commands()).toHaveLength(1)
    expect(ended).toHaveLength(1)
  })

  it.each(['D', 'D;x', 'D;', 'D;1.5'])('AC1: %s reads exit code 0', (end) => {
    const { marks } = fed([
      [633, 'C'],
      [633, end]
    ])
    expect(marks.commands().map((c) => c.exitCode)).toEqual([0])
  })

  it('reads the code before any further parameters, as kitty and Ghostty send them', () => {
    expect(parseShellMark(133, 'D;127;aid=12')).toEqual({ kind: 'command-end', exitCode: 127 })
    expect(parseShellMark(133, 'A;cl=m;aid=12')).toEqual({ kind: 'prompt-start' })
  })

  it("AC1: OSC 7 reads the host and the percent-decoded path; 633's Cwd the path", () => {
    expect(fed([[7, 'file://host/tmp/a%20b']]).marks.directory()).toEqual({
      host: 'host',
      path: '/tmp/a b'
    })
    expect(fed([[7, 'file:///srv']]).marks.directory()).toEqual({ host: '', path: '/srv' })
    expect(fed([[633, 'P;Cwd=/srv']]).marks.directory()).toEqual({ path: '/srv' })
    // VS Code's escapes: `\\` and `\xHH`.
    expect(fed([[633, 'P;Cwd=/a\\x3bb\\\\c']]).marks.directory()).toEqual({ path: '/a;b\\c' })
  })

  it('keeps the last directory reported, and ignores a malformed OSC 7', () => {
    const { marks } = fed([
      [7, 'file://h/one'],
      [7, 'file://h/bad%zz'],
      [7, 'kitty-shell-cwd://h/x'],
      [7, 'file://h'],
      [633, 'P;Cwd=']
    ])
    expect(marks.directory()).toEqual({ host: 'h', path: '/one' })
  })

  it('AC1: 633 E and other properties change nothing', () => {
    for (const data of ['E;ls', 'E;ls;nonce', 'P;IsWindows=False', 'Z']) {
      expect(parseShellMark(633, data)).toBeUndefined()
    }
    expect(parseShellMark(133, 'P;Cwd=/srv')).toBeUndefined()
    const { marks } = fed([
      [633, 'A'],
      [633, 'B'],
      [633, 'E;ls'],
      [633, 'C'],
      [633, 'D;1']
    ])
    expect(marks.commands()).toEqual([{ line: 1, start: 1003, end: 1004, exitCode: 1 }])
    expect(marks.directory()).toBeUndefined()
  })

  it("D2: a command's line is its B row, else its A row, else its C row; never an earlier prompt's", () => {
    const lines = (sequence: string[]): number[] =>
      fed(sequence.map((data) => [133, data]))
        .marks.commands()
        .map((c) => c.line)
    expect(lines(['A', 'C', 'D'])).toEqual([0])
    expect(lines(['C', 'D'])).toEqual([0])
    expect(lines(['A', 'B', 'C', 'D', 'C', 'D'])).toEqual([1, 4])
    // Ctrl+C at a prompt: the next prompt's A, with no B yet.
    expect(lines(['A', 'B', 'A', 'C', 'D'])).toEqual([2])
  })

  it('D2: a running command is no command yet, and a second C starts nothing', () => {
    const { marks, ended } = fed([
      [133, 'B'],
      [133, 'C'],
      [133, 'C']
    ])
    expect(marks.commands()).toEqual([])
    expect(ended).toEqual([])
    marks.feed({ kind: 'command-end', exitCode: 4 }, 2000, () => 9)
    expect(marks.commands()).toEqual([{ line: 0, start: 1001, end: 2000, exitCode: 4 }])
  })

  it('D2: the prompts are the A rows, or the B rows in a terminal that never sent an A', () => {
    const prompts = (sequence: string[]): readonly number[] =>
      fed(sequence.map((data) => [633, data])).marks.prompts()
    expect(prompts(['A', 'B', 'C', 'D', 'A', 'B'])).toEqual([0, 4])
    expect(prompts(['B', 'C', 'D', 'B'])).toEqual([0, 3])
    expect(prompts([])).toEqual([])
  })

  it('forgets the prompts and commands of a row gone from the scrollback, still ending a running one', () => {
    const { marks, ended } = fed([
      [133, 'A'],
      [133, 'B'],
      [133, 'C'],
      [133, 'D;1'],
      [133, 'A'],
      [133, 'B'],
      [133, 'C']
    ])
    for (const row of [0, 1, 5]) marks.forget(row)
    expect(marks.prompts()).toEqual([4])
    expect(marks.commands()).toEqual([])
    marks.feed({ kind: 'command-end', exitCode: 2 }, 3000, () => 7)
    expect(ended.map((c) => c.exitCode)).toEqual([1, 2])
  })

  it('keeps no row xterm gave no handle for (the alt screen), still ending its command', () => {
    const marks = new ShellMarks<number | undefined>()
    const ended: ShellCommand<number | undefined>[] = []
    marks.onCommandEnded((command) => ended.push(command))
    for (const kind of ['prompt-start', 'prompt-end', 'output-start'] as const) {
      marks.feed({ kind }, 0, () => undefined)
    }
    marks.feed({ kind: 'command-end', exitCode: 1 }, 1, () => undefined)
    expect(marks.prompts()).toEqual([])
    marks.feed({ kind: 'prompt-end' }, 2, () => undefined)
    expect(marks.prompts()).toEqual([])
    expect(marks.commands()).toEqual([])
    expect(ended.map((c) => c.exitCode)).toEqual([1])
  })

  it('stops calling a listener once unsubscribed', () => {
    const marks = new ShellMarks<number>()
    const calls: number[] = []
    const unsubscribe = marks.onCommandEnded((c) => calls.push(c.exitCode ?? -1))
    marks.feed({ kind: 'output-start' }, 0, () => 0)
    unsubscribe()
    marks.feed({ kind: 'command-end', exitCode: 1 }, 1, () => 0)
    expect(calls).toEqual([])
  })
})

describe('splitDirectory (#45 D8)', () => {
  const local = { cardDirectory: '/home/me/project', localHostName: 'Box' }

  it.each(['', 'localhost', 'box', 'BOX'])("takes a path reported for host '%s'", (host) => {
    expect(splitDirectory({ host, path: '/tmp' }, local)).toBe('/tmp')
  })

  it("takes OSC 633's Cwd, which names no host", () => {
    expect(splitDirectory({ path: '/srv/app' }, local)).toBe('/srv/app')
  })

  it("keeps the card's directory for another host, nothing reported or a relative path", () => {
    expect(splitDirectory({ host: 'other-host.invalid', path: '/tmp' }, local)).toBe(
      '/home/me/project'
    )
    expect(splitDirectory(undefined, local)).toBe('/home/me/project')
    expect(splitDirectory({ path: 'tmp' }, local)).toBe('/home/me/project')
  })

  it("always keeps an SSH card's directory", () => {
    expect(splitDirectory({ host: '', path: '/tmp' }, { ...local, sshHost: 'dev@box' })).toBe(
      '/home/me/project'
    )
  })
})

describe("this machine's host name for the renderer (#45 D8)", () => {
  it('round-trips through an argument, and is empty without one', () => {
    expect(parseHostName(['electron', hostNameArg('my-box.local')])).toBe('my-box.local')
    expect(parseHostName(['electron'])).toBe('')
  })
})

describe("ShellMarks' output positions (#60 D1)", () => {
  /** Feeds `marks` (a payload, the row and column it arrived at) to a fresh mark state. */
  function at(sequence: [string, number, number][]): ShellMarks<number> {
    const marks = new ShellMarks<number>()
    sequence.forEach(([data, row, x], i) => {
      const mark = parseShellMark(133, data)
      if (mark)
        marks.feed(
          mark,
          i,
          () => row,
          () => x
        )
    })
    return marks
  }

  it("AC1: keeps each ended command's C and D positions, with its line", () => {
    const marks = at([
      ['A', 0, 0],
      ['B', 0, 2],
      ['C', 1, 0],
      ['D;0', 3, 0],
      ['A', 3, 0],
      ['B', 3, 2],
      ['C', 3, 7],
      ['D;1', 4, 5]
    ])
    expect(marks.outputs()).toEqual([
      { command: marks.commands()[0], start: { line: 1, x: 0 }, end: { line: 3, x: 0 } },
      { command: marks.commands()[1], start: { line: 3, x: 7 }, end: { line: 4, x: 5 } }
    ])
    expect(marks.commands().map((c) => c.line)).toEqual([0, 3])
  })

  it('AC1: lists no running command, and none fed without a column', () => {
    const running = at([
      ['B', 0, 2],
      ['C', 1, 0]
    ])
    expect(running.outputs()).toEqual([])
    const { marks } = fed([
      [133, 'B'],
      [133, 'C'],
      [133, 'D']
    ])
    expect(marks.commands()).toHaveLength(1)
    expect(marks.outputs()).toEqual([])
  })

  it('AC1: forgets a command whose C row left the scrollback, also while it runs', () => {
    const marks = at([
      ['B', 0, 2],
      ['C', 1, 0],
      ['D', 2, 0],
      ['B', 2, 2],
      ['C', 3, 0]
    ])
    marks.forget(1)
    expect(marks.outputs()).toEqual([])
    expect(marks.commands()).toHaveLength(1)
    marks.forget(3)
    marks.feed(
      { kind: 'command-end', exitCode: 0 },
      9,
      () => 4,
      () => 0
    )
    expect(marks.commands()).toHaveLength(2)
    expect(marks.outputs()).toEqual([])
  })

  it('keeps no position on a row xterm gave no handle for (the alt screen)', () => {
    const marks = new ShellMarks<number | undefined>()
    marks.feed(
      { kind: 'prompt-end' },
      0,
      () => 0,
      () => 2
    )
    marks.feed(
      { kind: 'output-start' },
      1,
      () => undefined,
      () => 0
    )
    marks.feed(
      { kind: 'command-end', exitCode: 0 },
      2,
      () => 1,
      () => 0
    )
    expect(marks.commands()).toHaveLength(1)
    expect(marks.outputs()).toEqual([])
  })
})
