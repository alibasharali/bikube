/**
 * Copy command output (#60 D1, D3), free of DOM imports: which ended command's output the action
 * takes, and the buffer range it covers. Rows are absolute buffer lines, columns cells; a range's
 * end is exclusive.
 */
import type { CommandOutput } from './shell-marks'

/** A cell of the buffer: column `x` of absolute row `y`. */
export interface BufferPoint {
  x: number
  y: number
}

/** A command's output in the buffer (#60 D1), from `start` up to `end`, exclusive. */
export interface OutputRange {
  start: BufferPoint
  end: BufferPoint
}

/** An ended command as the choice reads it: its line's row and where its `C` and `D` arrived. */
export interface EndedOutput {
  line: number
  start: BufferPoint
  end: BufferPoint
}

/** The pane's viewport: its top row, its rows, its last scroll position (`baseY`), its columns. */
export interface OutputViewport {
  top: number
  rows: number
  bottom: number
  cols: number
}

/**
 * The ended commands of a mark state with their rows read (#60 D1): `row` gives a handle's
 * absolute row, undefined for one gone from the scrollback, which drops the command.
 */
export function endedOutputs<Line>(
  outputs: readonly CommandOutput<Line>[],
  row: (line: Line) => number | undefined
): EndedOutput[] {
  return outputs.flatMap(({ command, start, end }) => {
    const line = row(command.line)
    const startY = row(start.line)
    const endY = row(end.line)
    if (line === undefined || startY === undefined || endY === undefined) return []
    return [{ line, start: { x: start.x, y: startY }, end: { x: end.x, y: endY } }]
  })
}

/**
 * The range from where a `C` arrived to where its `D` did (#60 D1): a `D` at column 0 ends it at
 * the end of the row above. None when that leaves nothing between them.
 */
export function outputRange(
  start: BufferPoint,
  end: BufferPoint,
  cols: number
): OutputRange | null {
  const last = end.x === 0 && end.y > 0 ? { x: cols, y: end.y - 1 } : end
  return before(start, last) ? { start, end: last } : null
}

/** The cells a range covers, as xterm's `select(column, row, length)` counts them. */
export function rangeLength({ start, end }: OutputRange, cols: number): number {
  return (end.y - start.y) * cols + end.x - start.x
}

const before = (a: BufferPoint, b: BufferPoint): boolean => a.y < b.y || (a.y === b.y && a.x < b.x)

/**
 * The output Copy command output takes (#60 D3), or null for none. Only ended commands with
 * output count: a non-empty range that `hasOutput` (the text check, D1) accepts. At the bottom of
 * the scrollback, the last one; scrolled up, the first whose line is in the viewport, else the last
 * whose line is above its top row.
 */
export function chooseCommandOutput(
  commands: readonly EndedOutput[],
  { top, rows, bottom, cols }: OutputViewport,
  hasOutput: (range: OutputRange) => boolean
): OutputRange | null {
  const ordered = [...commands].sort((a, b) => a.line - b.line)
  const output = (command: EndedOutput): OutputRange | null => {
    const range = outputRange(command.start, command.end, cols)
    return range && hasOutput(range) ? range : null
  }
  const lastOf = (list: readonly EndedOutput[]): OutputRange | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const range = output(list[i]!)
      if (range) return range
    }
    return null
  }
  if (top >= bottom) return lastOf(ordered)
  for (const command of ordered) {
    if (command.line < top || command.line >= top + rows) continue
    const range = output(command)
    if (range) return range
  }
  return lastOf(ordered.filter((command) => command.line < top))
}
