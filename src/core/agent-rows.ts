/**
 * The Agent tab's Agents group (#75 D8): one row for the main agent, `Running` while the card's or
 * shell's activity is working (#31), else `Idle`. Subagents and background commands follow it
 * (S3 adds their rows after the main agent's). No Node imports: the renderer runs it.
 */
import type { Activity } from './activity'

export type AgentRowStatus = 'running' | 'idle' | 'done' | 'failed' | 'stopped'

/** One row of the Agents group. */
export interface AgentRow {
  kind: 'main'
  name: string
  status: AgentRowStatus
}

export const AGENT_ROW_STATUS_LABELS: Record<AgentRowStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped'
}

/** The Agents group's rows for the card's or shell's `activity`, the main agent first. */
export function agentRows(activity: Activity | undefined): AgentRow[] {
  return [{ kind: 'main', name: 'Main agent', status: activity === 'working' ? 'running' : 'idle' }]
}
