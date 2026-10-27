import { describe, expect, it } from 'vitest'
import { cardDatesTooltip, openedAgo } from './card-dates'

const CREATED = Date.UTC(2026, 9, 27, 14, 5)
const GB = { locale: 'en-GB', timeZone: 'UTC' }

describe('cardDatesTooltip (#69 D13)', () => {
  it('reads when the card was created and how long ago it was opened', () => {
    const now = CREATED + 10 * 60_000
    expect(cardDatesTooltip({ createdAt: CREATED, lastOpenedAt: now - 3 * 60_000 }, now, GB)).toBe(
      'Created 27 Oct 2026, 14:05 · Opened 3 min ago'
    )
  })

  it('reads Opened never for a card never opened here, and leaves out a missing creation', () => {
    expect(cardDatesTooltip({ createdAt: CREATED }, CREATED, GB)).toBe(
      'Created 27 Oct 2026, 14:05 · Opened never'
    )
    expect(cardDatesTooltip({ lastOpenedAt: CREATED }, CREATED + 30_000, GB)).toBe(
      'Opened just now'
    )
    expect(cardDatesTooltip({}, CREATED, GB)).toBe('Opened never')
  })
})

describe('openedAgo', () => {
  const at = (ms: number): string => openedAgo(CREATED, CREATED + ms, GB)

  it('counts minutes under an hour, hours under a day and days under a month', () => {
    expect(at(0)).toBe('just now')
    expect(at(59_999)).toBe('just now')
    // A clock that went back reads just now too.
    expect(at(-5_000)).toBe('just now')
    expect(at(60_000)).toBe('1 min ago')
    expect(at(59 * 60_000)).toBe('59 min ago')
    expect(at(60 * 60_000)).toBe('1 h ago')
    expect(at(23 * 3_600_000)).toBe('23 h ago')
    expect(at(24 * 3_600_000)).toBe('1 day ago')
    expect(at(29 * 86_400_000)).toBe('29 days ago')
  })

  it('names the date from a month on', () => {
    expect(at(30 * 86_400_000)).toBe('on 27 Oct 2026, 14:05')
  })
})
