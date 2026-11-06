import { describe, expect, it } from 'vitest'
import { GroupStamps, formatAge } from './status-time'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatAge (#79 D5)', () => {
  it('reads now under a minute, then whole minutes, hours and days rounded down', () => {
    expect(formatAge(0)).toBe('now')
    expect(formatAge(59 * SECOND)).toBe('now')
    expect(formatAge(MINUTE)).toBe('1m')
    expect(formatAge(4 * MINUTE + 59 * SECOND)).toBe('4m')
    expect(formatAge(59 * MINUTE + 59 * SECOND)).toBe('59m')
    expect(formatAge(2 * HOUR + 10 * MINUTE)).toBe('2h')
    expect(formatAge(23 * HOUR + 59 * MINUTE)).toBe('23h')
    expect(formatAge(3 * DAY + 5 * HOUR)).toBe('3d')
  })

  it('reads a time ahead of the clock as now', () => {
    expect(formatAge(-5 * MINUTE)).toBe('now')
  })
})

describe('GroupStamps (#79 D6)', () => {
  it('stamps a row at its start and again only when its group changes', () => {
    const stamps = new GroupStamps()
    expect(stamps.update([{ cardId: 'fix' }], 100).get('fix')).toBe(100)
    // Still Idle: the stamp stays.
    expect(stamps.update([{ cardId: 'fix' }], 200).get('fix')).toBe(100)
    expect(stamps.update([{ cardId: 'fix', activity: 'working' }], 300).get('fix')).toBe(300)
    expect(stamps.update([{ cardId: 'fix', activity: 'working' }], 400).get('fix')).toBe(300)
    expect(stamps.update([{ cardId: 'fix', activity: 'waiting' }], 500).get('fix')).toBe(500)
    // Waiting and question are both Needs you.
    expect(stamps.update([{ cardId: 'fix', activity: 'question' }], 600).get('fix')).toBe(500)
  })

  it('forgets a row once it stops, so its next start stamps it again', () => {
    const stamps = new GroupStamps()
    stamps.update([{ cardId: 'fix' }, { cardId: 'logs' }], 100)
    const after = stamps.update([{ cardId: 'logs' }], 200)
    expect(after.has('fix')).toBe(false)
    expect(after.get('logs')).toBe(100)
    expect(stamps.update([{ cardId: 'fix' }, { cardId: 'logs' }], 300).get('fix')).toBe(300)
  })

  it('returns the same map while nothing changed', () => {
    const stamps = new GroupStamps()
    const first = stamps.update([{ cardId: 'fix' }], 100)
    expect(stamps.update([{ cardId: 'fix' }], 200)).toBe(first)
    expect(stamps.update([{ cardId: 'fix', activity: 'working' }], 300)).not.toBe(first)
  })
})
