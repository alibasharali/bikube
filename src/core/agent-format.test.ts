import { describe, expect, it } from 'vitest'
import { clockTime, formatDuration } from './agent-format'

describe("the Agent tab's durations and times (#75 D8, D10)", () => {
  it('reads seconds, minutes and seconds, hours and minutes', () => {
    expect(formatDuration(400)).toBe('<1s')
    expect(formatDuration(41_900)).toBe('41s')
    expect(formatDuration((3 * 60 + 12) * 1000)).toBe('3m 12s')
    expect(formatDuration((64 * 60 + 30) * 1000)).toBe('1h 4m')
    expect(formatDuration(-5)).toBe('<1s')
  })

  it("gives the time of day in the locale's hours and minutes", () => {
    const ms = Date.parse('2026-10-29T14:32:10Z')
    expect(clockTime(ms, { locale: 'en-GB', timeZone: 'UTC' })).toBe('14:32')
  })
})
