/**
 * How the Agent tab reads durations and times (#75 D8, D10). Plain TS, no DOM: the locale and
 * time zone default to the system's, and tests pass their own.
 */
import type { DateFormat } from './card-dates'

/** A duration: `<1s`, `41s`, `3m 12s`, `1h 4m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The time of day of `ms` in the locale's hours and minutes, e.g. `14:32` in en-GB. */
export function clockTime(ms: number, format: DateFormat = {}): string {
  return new Intl.DateTimeFormat(format.locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(format.timeZone !== undefined && { timeZone: format.timeZone })
  }).format(ms)
}
