/**
 * How Claude Code's `cleanupPeriodDays` in `~/.claude/settings.json` reads (#80 D3), as main
 * answers `claudeRetention:read`. No Node imports: the renderer uses it.
 *
 * - `low`: unset (Claude Code's 30 days) or a number below 3650; `days` is the one in effect.
 * - `ok`: 3650 or more, left alone; `days` is the set value.
 * - `unknown`: a non-number value, an unreadable or invalid file, or a link: never offered or
 *   written.
 */
/** The value Bikube sets (D3): about ten years. */
export const CLAUDE_RETENTION_DAYS = 3650

export type ClaudeRetention =
  { state: 'low'; days: number } | { state: 'ok'; days: number } | { state: 'unknown' }

/** The notice's text (#80 D5) for the days in effect. */
export const retentionNotice = (days: number): string =>
  `Claude Code deletes conversations after ${days} days, so this card can't resume after that.`

/** Agent setup's warning (#80 D7) for the days in effect. */
export const retentionWarning = (days: number): string =>
  `Claude Code deletes conversations older than ${days} days; Bikube cards can't resume them after that.`

/**
 * What main's prepare before a resume found (#80 D11): the transcript `present`, `restored` from
 * the card's backup, or `missing` with no backup (D12's panel); `refused` (a card id, folder or
 * session id that doesn't check) and `failed` start the card as today.
 */
export type ConversationPrepare = 'present' | 'restored' | 'missing' | 'refused' | 'failed'

/**
 * The days D12's text names (D5's `<n>`): the set value (or 30 when unset, which reads low), and
 * 30 when the setting is unknown or not read yet.
 */
export const retentionDays = (retention: ClaudeRetention | null | undefined): number =>
  retention && retention.state !== 'unknown' ? retention.days : 30

/** The card view's text for a card whose conversation is gone (#80 D12). */
export const conversationGoneText = (days: number): string =>
  `This card's Claude Code conversation isn't on this machine. Claude Code deletes conversations after ${days} days, or it ran on another machine.`
