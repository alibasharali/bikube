/**
 * A trigger's status in the Shells tab, from its run state and its dev servers: idle until run,
 * running (a spinner) while its command runs, serving once a `localhost` port it printed listens
 * (a dev server is up), then done or failed by its command's exit code. Plain TS.
 */
import type { CardRunState } from './card-status'

export type TriggerStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'serving'; port: number }
  | { kind: 'done'; line: string }
  | { kind: 'failed'; code: number | null; line: string; tail: string[] }

export function triggerStatus(
  state: CardRunState | undefined,
  listening: readonly { port: number }[]
): TriggerStatus {
  if (!state) return { kind: 'idle' }
  if (state.kind === 'running') {
    const first = listening[0]
    return first ? { kind: 'serving', port: first.port } : { kind: 'running' }
  }
  if (state.kind === 'failed') {
    return { kind: 'failed', code: null, line: state.reason, tail: [state.reason] }
  }
  if (!state.exit) return { kind: 'idle' }
  return state.exit.code === 0
    ? { kind: 'done', line: state.exit.line }
    : { kind: 'failed', code: state.exit.code, line: state.exit.line, tail: state.exit.tail }
}

/** A failure's heading: `Failed (exit 2)`, or `Couldn't start` when it never ran. */
export const failureHeading = (status: { code: number | null }): string =>
  status.code === null ? "Couldn't start" : `Failed (exit ${status.code})`

/** The status's tooltip: what it is, with the exit code and the last line it printed. */
export function triggerStatusLabel(status: TriggerStatus): string {
  switch (status.kind) {
    case 'idle':
      return 'Not running'
    case 'running':
      return 'Running'
    case 'serving':
      return `Running, listening on localhost:${status.port}`
    case 'done':
      return status.line ? `Done: ${status.line}` : 'Done'
    case 'failed': {
      const head = failureHeading(status)
      return status.line ? `${head}: ${status.line}` : head
    }
  }
}

/**
 * The notification for a trigger that just ended (its title is the trigger's): a failure only,
 * unless its workspace's Shells tab is in view (`shellsInView`), where its row shows it. Its body
 * is the heading and workspace, then the last line it printed.
 */
export function triggerFailureNotice(
  status: TriggerStatus,
  workspace: string,
  shellsInView: boolean
): { body: string } | null {
  if (status.kind !== 'failed' || shellsInView) return null
  const head = `${failureHeading(status)} · ${workspace}`
  return { body: status.line ? `${head}\n${status.line}` : head }
}
