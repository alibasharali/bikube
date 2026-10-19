import { describe, expect, it } from 'vitest'
import {
  chooseCommandOutput,
  endedOutputs,
  outputRange,
  rangeLength,
  type EndedOutput,
  type OutputViewport
} from './command-output'
import type { CommandOutput } from './shell-marks'

// Three commands, each a line, its output from the next row, and its D at column 0 of the row
// after 30 lines of output; then the current prompt. 80 columns, 24 rows shown.
const command = (line: number): EndedOutput => ({
  line,
  start: { x: 0, y: line + 1 },
  end: { x: 0, y: line + 31 }
})
const commands = [command(0), command(31), command(62)]
const cols = 80
const bottom = 93 - 23
const view = (top: number): OutputViewport => ({ top, rows: 24, bottom, cols })
const always = (): boolean => true
const range = (line: number): ReturnType<typeof outputRange> =>
  outputRange(command(line).start, command(line).end, cols)

describe('outputRange (#60 D1, AC1)', () => {
  it('runs from the C position to the D position, exclusive', () => {
    expect(outputRange({ x: 7, y: 3 }, { x: 5, y: 4 }, cols)).toEqual({
      start: { x: 7, y: 3 },
      end: { x: 5, y: 4 }
    })
  })

  it('ends at the end of the row above for a D at column 0', () => {
    expect(outputRange({ x: 0, y: 1 }, { x: 0, y: 3 }, cols)).toEqual({
      start: { x: 0, y: 1 },
      end: { x: 80, y: 2 }
    })
  })

  it('is none for C and D at the same position, or a D at column 0 just below a C at 0', () => {
    expect(outputRange({ x: 4, y: 2 }, { x: 4, y: 2 }, cols)).toBeNull()
    expect(outputRange({ x: 0, y: 2 }, { x: 0, y: 2 }, cols)).toBeNull()
    expect(outputRange({ x: 80, y: 2 }, { x: 0, y: 3 }, cols)).toBeNull()
    expect(outputRange({ x: 4, y: 3 }, { x: 2, y: 3 }, cols)).toBeNull()
  })

  it("gives xterm's selection length across rows", () => {
    expect(rangeLength({ start: { x: 7, y: 3 }, end: { x: 5, y: 4 } }, cols)).toBe(78)
    expect(rangeLength({ start: { x: 0, y: 1 }, end: { x: 80, y: 2 } }, cols)).toBe(160)
  })
})

describe('chooseCommandOutput (#60 D3, AC1)', () => {
  it('takes the last ended command with output at the bottom', () => {
    expect(chooseCommandOutput(commands, view(bottom), always)).toEqual(range(62))
  })

  it("takes the command whose line is the viewport's top row", () => {
    expect(chooseCommandOutput(commands, view(31), always)).toEqual(range(31))
    expect(chooseCommandOutput(commands, view(0), always)).toEqual(range(0))
  })

  it('takes the first command whose line is in the viewport', () => {
    expect(chooseCommandOutput(commands, view(20), always)).toEqual(range(31))
  })

  it('takes the last command above the top when the top is inside its output and the next line below', () => {
    // Rows 35…58 shown: inside the second's output, the third's line (62) below.
    expect(chooseCommandOutput(commands, view(35), always)).toEqual(range(31))
  })

  it('is none scrolled above every command', () => {
    const later = [command(40)]
    expect(chooseCommandOutput(later, { ...view(0), rows: 10 }, always)).toBeNull()
    expect(chooseCommandOutput([], view(bottom), always)).toBeNull()
  })

  it('never takes a command with C and D at the same position', () => {
    const empty: EndedOutput = { line: 62, start: { x: 3, y: 62 }, end: { x: 3, y: 62 } }
    expect(chooseCommandOutput([command(0), command(31), empty], view(bottom), always)).toEqual(
      range(31)
    )
    expect(chooseCommandOutput([command(0), empty], view(50), always)).toEqual(range(0))
  })

  it('skips a command whose text is empty, as the predicate says', () => {
    const hasOutput = (r: { start: { y: number } }): boolean => r.start.y !== 63
    expect(chooseCommandOutput(commands, view(bottom), hasOutput)).toEqual(range(31))
    expect(chooseCommandOutput(commands, view(50), hasOutput)).toEqual(range(31))
  })

  it('takes the commands in any order', () => {
    const shuffled = [commands[2]!, commands[0]!, commands[1]!]
    expect(chooseCommandOutput(shuffled, view(bottom), always)).toEqual(range(62))
    expect(chooseCommandOutput(shuffled, view(20), always)).toEqual(range(31))
  })
})

describe('endedOutputs (#60 D1)', () => {
  const output = (line: number, start: number, end: number): CommandOutput<number> => ({
    command: { line, start: 0, end: 1, exitCode: 0 },
    start: { line: start, x: 2 },
    end: { line: end, x: 0 }
  })

  it("reads each command's rows, dropping one whose row is gone", () => {
    const rows = new Map([
      [1, 10],
      [2, 11],
      [3, 15]
    ])
    expect(
      endedOutputs([output(1, 2, 3), output(3, 4, 5)], (line: number) => rows.get(line))
    ).toEqual([{ line: 10, start: { x: 2, y: 11 }, end: { x: 0, y: 15 } }])
  })
})
