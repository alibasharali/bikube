/**
 * The Agent tab's Agents group (#75 D8): one row for the main agent, `Running` while the card's or
 * shell's activity is working (#31), else `Idle`; then the summary's subagents and background
 * commands, newest first, a background command `Stopped` once the card's or shell's shell isn't
 * running; finished rows past the latest 5 fold into one `N finished` row. No Node imports: the
 * renderer runs it.
 */
import type { Activity } from './activity'
import type { AgentTask } from './agent-summary'

export type AgentRowStatus = 'running' | 'idle' | 'done' | 'failed' | 'stopped'

/** One row of the Agents group: the main agent's carries only its kind, name and status. */
export interface AgentRow {
  kind: 'main' | AgentTask['kind']
  name: string
  status: AgentRowStatus
  /** The tool use's id. */
  id?: string
  /** A subagent's task description. */
  description?: string | null
  startedAt?: number | null
  endedAt?: number | null
  /** A subagent's tool uses, null while unknown. */
  toolUses?: number | null
}

export const AGENT_ROW_STATUS_LABELS: Record<AgentRowStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped'
}

/** How many of the newest subagent and background rows always show (D8). */
export const SHOWN_AGENT_ROWS = 5

/**
 * The Agents group's rows for the card's or shell's `activity`, the main agent first, then
 * `agents` (the summary's, oldest first) newest first; `shellRunning` false shows a running
 * background command as stopped.
 */
export function agentRows(
  activity: Activity | undefined,
  agents: readonly AgentTask[] = [],
  shellRunning = true
): AgentRow[] {
  const rows: AgentRow[] = [
    { kind: 'main', name: 'Main agent', status: activity === 'working' ? 'running' : 'idle' }
  ]
  for (let i = agents.length - 1; i >= 0; i--) {
    const task = agents[i]
    const stopped = task.kind === 'background' && task.status === 'running' && !shellRunning
    rows.push({
      kind: task.kind,
      id: task.id,
      name: task.name,
      description: task.description,
      status: stopped ? 'stopped' : task.status,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      toolUses: task.toolUses
    })
  }
  return rows
}

/**
 * A row's duration at `now` (ms): live while running, its end minus its start after; null for the
 * main agent and a row without both times.
 */
export function agentDuration(row: AgentRow, now: number): number | null {
  if (row.kind === 'main' || row.startedAt === null || row.startedAt === undefined) return null
  if (row.status === 'running') return Math.max(0, now - row.startedAt)
  if (row.endedAt === null || row.endedAt === undefined) return null
  return Math.max(0, row.endedAt - row.startedAt)
}

/**
 * `rows` (from `agentRows`) split into those shown and the finished ones folded into the
 * `N finished` row: the main agent and the latest 5 others always show, and after them only the
 * running ones.
 */
export function foldAgentRows(rows: readonly AgentRow[]): {
  shown: AgentRow[]
  finished: AgentRow[]
} {
  const shown: AgentRow[] = []
  const finished: AgentRow[] = []
  let others = 0
  for (const row of rows) {
    if (row.kind === 'main') shown.push(row)
    else if (others++ < SHOWN_AGENT_ROWS || row.status === 'running') shown.push(row)
    else finished.push(row)
  }
  return { shown, finished }
}
