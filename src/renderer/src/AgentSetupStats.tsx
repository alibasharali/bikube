import { useEffect, useMemo, useState } from 'react'
import {
  statsEmpty,
  type ClaudeStats,
  type StatsCount,
  type StatsDay
} from '../../core/claude-stats-types'
import { formatCount, formatTokens } from '../../core/usage-format'
import type { Workspace } from '../../core/workspace-store'
import { refreshStats, statsExtraFolders, statsRequested, useStats } from './agent-setup-data'

/**
 * The Agent setup page's Stats (#68 D14): the totals, a chart of tokens per day with sessions per
 * day under it (a hover tooltip, and a table giving each day's numbers), Tokens by model and the
 * Most used lists, from the Claude Code transcripts of the workspace folder and its worktree
 * cards' folders. Read when first shown and on Refresh only (D26); not filtered by the search
 * (D25). Colours are the app theme's tokens only, so it follows every theme (D7). No cost.
 */

const plural = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`

const dayLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})
const fullDayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})
/** A `YYYY-MM-DD` date as `Oct 26` (or `Mon, Oct 26, 2026` with `full`), its calendar day kept. */
const formatDay = (date: string, full = false): string =>
  (full ? fullDayLabel : dayLabel).format(new Date(`${date}T00:00:00Z`))

export function StatsSection({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const folder = workspace.directory
  const { reading, stats } = useStats(folder)
  const extra = useMemo(() => statsExtraFolders(workspace), [workspace])
  // Read when the section is first shown in this run (D14); then on Refresh only.
  useEffect(() => {
    if (!statsRequested(folder)) void refreshStats(folder, extra)
  }, [folder, extra])

  return (
    <div className="agent-setup-stats" data-testid="agent-setup-stats">
      <p role="status" className="agent-setup-empty agent-setup-stats-status">
        {reading || stats === undefined ? 'Reading sessions…' : ''}
      </p>
      {stats === null ? (
        <p className="agent-setup-empty" data-testid="agent-setup-stats-failed">
          Couldn&apos;t read the sessions. Press Refresh to try again.
        </p>
      ) : stats === undefined ? null : statsEmpty(stats) ? (
        <p className="agent-setup-empty" data-testid="agent-setup-stats-empty">
          No Claude Code sessions in the last 30 days
        </p>
      ) : (
        <StatsBody stats={stats} />
      )}
    </div>
  )
}

function StatsBody({ stats }: { stats: ClaudeStats }): React.JSX.Element {
  return (
    <>
      <div className="agent-setup-stats-totals">
        <span className="agent-setup-stats-total" data-testid="agent-setup-stats-sessions">
          <strong>{formatCount(stats.sessions)}</strong>{' '}
          {stats.sessions === 1 ? 'session' : 'sessions'}
        </span>
        <span className="agent-setup-stats-total" data-testid="agent-setup-stats-tokens">
          <strong>{formatCount(stats.tokens)}</strong> {stats.tokens === 1 ? 'token' : 'tokens'}
        </span>
        <span
          className="agent-setup-stats-total"
          data-testid="agent-setup-stats-folders"
          title={stats.folders.join('\n')}
        >
          <strong>{formatCount(stats.folders.length)}</strong>{' '}
          {stats.folders.length === 1 ? 'folder' : 'folders'}
        </span>
        <span className="agent-setup-stats-period">Last 30 days</span>
      </div>
      <DayChart days={stats.days} />
      <h4 className="agent-setup-subheading">Tokens by model</h4>
      <ModelRows stats={stats} />
      <h4 className="agent-setup-subheading">Most used</h4>
      <div className="agent-setup-stats-lists">
        <UsedList title="Tools" testId="tools" rows={stats.tools} />
        <UsedList title="Skills" testId="skills" rows={stats.skills} />
        <UsedList title="Subagents" testId="subagents" rows={stats.subagents} />
      </div>
    </>
  )
}

/**
 * Tokens per day as bars, sessions per day as smaller bars under them on their own scale, over
 * the 30 days; hovering a day shows its numbers, and the table under the chart gives every day's.
 */
function DayChart({ days }: { days: StatsDay[] }): React.JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)
  const maxTokens = Math.max(1, ...days.map((d) => d.tokens))
  const maxSessions = Math.max(1, ...days.map((d) => d.sessions))
  const peakTokens = Math.max(0, ...days.map((d) => d.tokens))
  const peakSessions = Math.max(0, ...days.map((d) => d.sessions))
  const shown = hovered === null ? null : days[hovered]
  const height = (value: number, max: number): string =>
    value === 0 ? '0' : `max(2px, ${(value / max) * 100}%)`
  return (
    <figure className="agent-setup-chart">
      <figcaption className="agent-setup-chart-legend">
        {/* Each series on its own scale, its tallest bar's value given here. */}
        <span className="agent-setup-chart-key agent-setup-chart-key-tokens">
          Tokens per day{' '}
          <span className="agent-setup-chart-peak">· max {formatTokens(peakTokens)}</span>
        </span>
        <span className="agent-setup-chart-key agent-setup-chart-key-sessions">
          Sessions per day{' '}
          <span className="agent-setup-chart-peak">· max {formatCount(peakSessions)}</span>
        </span>
      </figcaption>
      <div
        className="agent-setup-chart-plot"
        aria-hidden="true"
        onMouseLeave={() => setHovered(null)}
      >
        <div className="agent-setup-chart-days">
          {days.map((day, i) => (
            <div
              key={day.date}
              className="agent-setup-chart-day"
              data-testid="agent-setup-stats-bar"
              data-hovered={hovered === i}
              onMouseEnter={() => setHovered(i)}
            >
              <div className="agent-setup-chart-tokens">
                <span style={{ height: height(day.tokens, maxTokens) }} />
              </div>
              <div className="agent-setup-chart-sessions">
                <span style={{ height: height(day.sessions, maxSessions) }} />
              </div>
            </div>
          ))}
        </div>
        <div className="agent-setup-chart-axis">
          <span>{formatDay(days[0]!.date)}</span>
          <span>{formatDay(days[days.length - 1]!.date)}</span>
        </div>
        {shown && hovered !== null && (
          <div
            className="agent-setup-chart-tooltip"
            data-testid="agent-setup-stats-tooltip"
            // Kept inside the chart: from a day's left edge in the first half, its right edge after.
            style={
              hovered < days.length / 2
                ? { left: `${(hovered / days.length) * 100}%` }
                : { right: `${((days.length - 1 - hovered) / days.length) * 100}%` }
            }
          >
            <strong>{formatDay(shown.date, true)}</strong>
            <span>{plural(shown.tokens, 'token', 'tokens')}</span>
            <span>{plural(shown.sessions, 'session', 'sessions')}</span>
          </div>
        )}
      </div>
      <details className="agent-setup-chart-table">
        <summary>Daily numbers</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Tokens</th>
              <th scope="col">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.date} data-testid="agent-setup-stats-day" data-date={day.date}>
                <th scope="row">{formatDay(day.date, true)}</th>
                <td>{formatCount(day.tokens)}</td>
                <td>{formatCount(day.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** One row per model: its name, its share of the tokens as a bar, and its total. */
function ModelRows({ stats }: { stats: ClaudeStats }): React.JSX.Element {
  const total = Math.max(
    1,
    stats.models.reduce((sum, m) => sum + m.tokens, 0)
  )
  return (
    <ul className="agent-setup-rows">
      {stats.models.map((m) => {
        const share = Math.round((m.tokens / total) * 100)
        return (
          <li key={m.model} className="agent-setup-row" data-testid="agent-setup-stats-model">
            <div className="agent-setup-stats-share-head">
              <span className="agent-setup-stats-name" data-testid="agent-setup-stats-name">
                {m.model}
              </span>
              <span className="agent-setup-stats-share">{share}%</span>
              <span className="agent-setup-stats-value" data-testid="agent-setup-stats-value">
                {formatCount(m.tokens)}
              </span>
            </div>
            <div
              className="agent-setup-stats-bar-track"
              role="meter"
              aria-label={`${m.model} share of tokens`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={share}
            >
              <span style={{ width: `${(m.tokens / total) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function UsedList({
  title,
  testId,
  rows
}: {
  title: string
  testId: string
  rows: StatsCount[]
}): React.JSX.Element {
  return (
    <section className="agent-setup-stats-list" data-testid={`agent-setup-stats-${testId}`}>
      <h5 className="agent-setup-stats-list-title">{title}</h5>
      {rows.length === 0 ? (
        <p className="agent-setup-empty">None</p>
      ) : (
        <ol className="agent-setup-rows">
          {rows.map((row) => (
            <li
              key={row.name}
              className="agent-setup-stats-used"
              data-testid="agent-setup-stats-used"
            >
              <span
                className="agent-setup-stats-name"
                data-testid="agent-setup-stats-name"
                title={row.name}
              >
                {row.name}
              </span>
              <span className="agent-setup-stats-value" data-testid="agent-setup-stats-value">
                {formatCount(row.count)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
