/**
 * The Agent setup page's Stats (#68 D14) as main sends them. Plain TS with no Node imports: the
 * renderer shows them. No cost anywhere (#50: Bikube estimates none).
 */

/** How many days Stats cover: the last 30, ending today (local dates). */
export const STATS_DAYS = 30

/** One day of the chart: its local date (`YYYY-MM-DD`), tokens and sessions started. */
export interface StatsDay {
  date: string
  tokens: number
  sessions: number
}

/** A Most used row: a tool's, skill's or subagent's name and how often it was used. */
export interface StatsCount {
  name: string
  count: number
}

/** A Tokens by model row. */
export interface StatsModel {
  model: string
  tokens: number
}

export interface ClaudeStats {
  /** The folders counted: the workspace folder first, then each worktree folder. */
  folders: string[]
  /** The 30 days, oldest first, today last. */
  days: StatsDay[]
  /** Sessions whose first timestamped entry is in the period. */
  sessions: number
  /** Tokens (input + output + cache write + cache read) of the period's entries. */
  tokens: number
  /** Most tokens first. */
  models: StatsModel[]
  /** Top 10 each, most used first. */
  tools: StatsCount[]
  skills: StatsCount[]
  subagents: StatsCount[]
}

/** `agentSetup:stats`'s reply: refused when the request named no folders main takes (D28). */
export type ClaudeStatsRead = { ok: true; stats: ClaudeStats } | { ok: false }

/** The most extra folders a Stats request may name (D28). */
export const MAX_STATS_FOLDERS = 100

/** The 30 dates (`YYYY-MM-DD`) ending with `today`, oldest first: calendar days, no zone. */
export function statsWindow(today: string): string[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const dates: string[] = []
  for (let back = STATS_DAYS - 1; back >= 0; back--) {
    dates.push(new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10))
  }
  return dates
}

/** Whether Stats found nothing in the period: no session started and no token counted. */
export const statsEmpty = (stats: ClaudeStats): boolean =>
  stats.sessions === 0 && stats.tokens === 0

/**
 * The worktree folders a workspace's Stats count besides its own folder (D14): each local
 * worktree card's worktree, once, in board order.
 */
export function worktreeFolders(
  cards: readonly { host?: string; worktree?: { path: string } }[]
): string[] {
  const folders: string[] = []
  for (const card of cards) {
    const path = card.worktree?.path
    if (path !== undefined && card.host === undefined && !folders.includes(path)) folders.push(path)
  }
  return folders
}
