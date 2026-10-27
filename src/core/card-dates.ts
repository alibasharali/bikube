/**
 * The board card's dates tooltip (#69 D13): when the card was created and how long ago it was last
 * opened on this machine. Plain TS, no DOM: the renderer passes the clock; the locale and time
 * zone default to the system's, and tests pass their own.
 */
import type { Card } from './workspace-store'

export interface DateFormat {
  /** A BCP 47 locale; the system's when absent. */
  locale?: string
  /** An IANA time zone; the system's when absent. */
  timeZone?: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A date and time in the locale's short form, e.g. `27 Oct 2026, 14:05` in en-GB. */
export function dateTime(ms: number, format: DateFormat = {}): string {
  return new Intl.DateTimeFormat(format.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(format.timeZone !== undefined && { timeZone: format.timeZone })
  }).format(ms)
}

/**
 * How long ago `openedAt` was at `now`: `just now` under a minute (or a clock gone back), then
 * minutes, hours and days, and from 30 days the date itself (`on <date time>`).
 */
export function openedAgo(openedAt: number, now: number, format: DateFormat = {}): string {
  const ago = now - openedAt
  if (ago < MINUTE) return 'just now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`
  if (ago < 30 * DAY) {
    const days = Math.floor(ago / DAY)
    return days === 1 ? '1 day ago' : `${days} days ago`
  }
  return `on ${dateTime(openedAt, format)}`
}

/**
 * The tooltip: `Created <date time> · Opened <relative time>`, `Opened never` for a card never
 * opened here, without the `Created` part for a card from before creation times.
 */
export function cardDatesTooltip(
  card: Pick<Card, 'createdAt' | 'lastOpenedAt'>,
  now: number,
  format: DateFormat = {}
): string {
  const opened =
    card.lastOpenedAt === undefined
      ? 'Opened never'
      : `Opened ${openedAgo(card.lastOpenedAt, now, format)}`
  return card.createdAt === undefined
    ? opened
    : `Created ${dateTime(card.createdAt, format)} · ${opened}`
}
