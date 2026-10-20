import { BellDot, LoaderCircle, MessageCircleQuestion } from 'lucide-react'
import type { Activity } from '../../core/activity'
import { SMALL_ICON } from './icons'

/** A running terminal's status: running with nothing to report, or its agent's activity. */
export type TerminalStatus = 'running' | Activity

/**
 * A running terminal's status as an icon, the same in the sidebar tree and on the board card: a
 * green dot while it runs, a spinner while its agent works, an amber bell while it waits for the
 * user and an amber question mark while it needs an answer. Decorative: its holder names it.
 */
function StatusIcon({ status }: { status: TerminalStatus }): React.JSX.Element {
  const Icon =
    status === 'waiting'
      ? BellDot
      : status === 'question'
        ? MessageCircleQuestion
        : status === 'working'
          ? LoaderCircle
          : null
  return (
    <span className={`status-icon status-icon-${status}`} aria-hidden="true">
      {Icon && <Icon {...SMALL_ICON} />}
    </span>
  )
}

export default StatusIcon
