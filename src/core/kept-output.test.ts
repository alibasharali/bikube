import { describe, expect, it } from 'vitest'
import { MAX_KEPT_CHARS, keptOutput, restoredText } from './kept-output'

/** A screen of `total` scrollback rows (`row 0` oldest) under 2 screen rows, serialized plainly. */
function fakeSerialize(
  total: number,
  rowChars = 10
): { calls: number[]; serialize: (rows: number) => string } {
  const calls: number[] = []
  const serialize = (rows: number): string => {
    calls.push(rows)
    const shown = Math.min(rows, total)
    const lines: string[] = []
    for (let i = total - shown; i < total; i++) lines.push(`row ${i}`.padEnd(rowChars, '.'))
    lines.push('screen 1', 'screen 2')
    return lines.join('\r\n')
  }
  return { calls, serialize }
}

describe('keptOutput (#46 D3)', () => {
  it('serializes the scrollback setting’s rows when that fits', () => {
    const { calls, serialize } = fakeSerialize(50)
    expect(keptOutput(serialize, 10_000)).toBe(serialize(10_000))
    expect(calls[0]).toBe(10_000)
  })

  it('halves the rows until the text fits, keeping the newest rows (AC8)', () => {
    // 1,502 chars a row: 625 rows (~940k) is the first count that fits.
    const { calls, serialize } = fakeSerialize(10_000, 1_500)
    const kept = keptOutput(serialize, 10_000)
    expect(calls).toEqual([10_000, 5_000, 2_500, 1_250, 625])
    expect(kept.length).toBeLessThanOrEqual(MAX_KEPT_CHARS)
    expect(kept).toContain('row 9999')
    expect(kept).not.toContain('row 9374')
    expect(kept.endsWith('screen 2')).toBe(true)
  })

  it('keeps the screen alone at 0 rows, and cuts a screen still too long at a line break', () => {
    const screenLine = 'x'.repeat(300_000)
    const serialize = (rows: number): string =>
      [
        ...Array<string>(rows).fill('old'),
        'first',
        screenLine,
        screenLine,
        screenLine,
        screenLine,
        'last'
      ].join('\r\n')
    const kept = keptOutput(serialize, 4)
    expect(kept.length).toBeLessThanOrEqual(MAX_KEPT_CHARS)
    expect(kept.startsWith(screenLine)).toBe(true)
    expect(kept.endsWith('last')).toBe(true)
  })
})

describe('restoredText (#46 D5)', () => {
  it('is the save, reset attributes, a fresh line and the dim separator with its time, then CRLF', () => {
    const savedAt = new Date(2026, 9, 19, 14, 32).getTime()
    expect(restoredText({ data: '\x1b[31mred', savedAt }, 'en-GB')).toBe(
      '\x1b[31mred\x1b[0m\r\n\x1b[2m── Previous output · 19 Oct 2026, 14:32 ──\x1b[0m\r\n'
    )
  })
})
