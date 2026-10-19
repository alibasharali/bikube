import { describe, expect, it } from 'vitest'
import { parseShellMark, ShellMarks, type ShellCommand, type ShellMarkFamily } from './shell-marks'

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
