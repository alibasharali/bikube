/**
 * How Claude Code's `cleanupPeriodDays` in `~/.claude/settings.json` reads (#80 D3), as main
 * answers `claudeRetention:read`. No Node imports: the renderer uses it.
 *
 * - `low`: unset (Claude Code's 30 days) or a number below 3650; `days` is the one in effect.
 * - `ok`: 3650 or more, left alone.
 * - `unknown`: a non-number value, an unreadable or invalid file, or a link: never offered or
 *   written.
 */
export type ClaudeRetention =
  { state: 'low'; days: number } | { state: 'ok' } | { state: 'unknown' }

/** The notice's text (#80 D5) for the days in effect. */
export const retentionNotice = (days: number): string =>
  `Claude Code deletes conversations after ${days} days, so this card can't resume after that.`
