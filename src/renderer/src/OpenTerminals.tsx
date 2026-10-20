import { AppWindow } from 'lucide-react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { ACTIVITY_LABELS, type Activity } from '../../core/activity'
import { openTerminals, type OpenTerminal } from '../../core/open-terminals'
import { shellCards } from '../../core/workspace-shells'
import type { Workspace } from '../../core/workspace-store'
import { cardTerminals } from './card-terminals'
import { useInWindow } from './card-windows'
import { SMALL_ICON } from './icons'
import WorkspaceBadge from './WorkspaceBadge'

/** Every card's and shell's id in `workspaces`. */
function terminalIds(workspaces: readonly Workspace[]): string[] {
  return workspaces.flatMap((w) => [...w.cards.map((c) => c.id), ...shellCards(w).map((s) => s.id)])
}

const isRunning = (cardId: string): boolean => cardTerminals().runState(cardId)?.kind === 'running'
const activityOf = (cardId: string): Activity | undefined =>
  cardTerminals().status(cardId)?.activity

/**
 * The running cards and shells, following starts, exits and activity changes, but not each
 * output chunk: the snapshot is a string that changes only when one of those does.
 */
function useOpenTerminals(workspaces: readonly Workspace[]): OpenTerminal[] {
  const joined = terminalIds(workspaces).join('\n')
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = joined
        .split('\n')
        .filter(Boolean)
        .map((id) => cardTerminals().subscribe(id, listener))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [joined]
  )
  const key = useSyncExternalStore(subscribe, () =>
    joined
      .split('\n')
      .map((id) => (isRunning(id) ? `${id}\t${activityOf(id) ?? ''}` : ''))
      .join('\n')
  )
  // `key` stands for the running states and activities read here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => openTerminals(workspaces, isRunning, activityOf), [workspaces, key])
}

interface OpenTerminalsProps {
  workspaces: readonly Workspace[]
  activeId: string | null
  /** The card or shell open at full size in the active workspace, or null. */
  openId: string | null
  onOpen: (workspaceId: string, cardId: string) => void
}

/**
 * The sidebar's lower half: every running card and shell in every workspace, with its workspace,
 * opened as a palette pick opens it (switching workspace, or focusing its own window).
 */
function OpenTerminals({
  workspaces,
  activeId,
  openId,
  onOpen
}: OpenTerminalsProps): React.JSX.Element {
  const rows = useOpenTerminals(workspaces)
  const byId = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces])
  return (
    <section className="open-terminals" data-testid="open-terminals" aria-label="Open terminals">
      <div className="sidebar-section-header">
        <span className="sidebar-title">Open terminals</span>
        {rows.length > 0 && (
          <span className="open-terminals-count" data-testid="open-terminals-count">
            {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="open-terminals-empty" data-testid="open-terminals-empty">
          No terminals running
        </p>
      ) : (
        <ul className="open-terminals-list">
          {rows.map((row) => {
            const workspace = byId.get(row.workspaceId)
            if (!workspace) return null
            return (
              <OpenTerminalRow
                key={row.cardId}
                row={row}
                workspace={workspace}
                current={row.workspaceId === activeId && row.cardId === openId}
                onOpen={onOpen}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}

function OpenTerminalRow({
  row,
  workspace,
  current,
  onOpen
}: {
  row: OpenTerminal
  workspace: Workspace
  current: boolean
  onOpen: OpenTerminalsProps['onOpen']
}): React.JSX.Element {
  const inWindow = useInWindow(row.cardId)
  return (
    <li>
      <button
        type="button"
        className={current ? 'open-terminal active' : 'open-terminal'}
        data-testid="open-terminal"
        data-kind={row.kind}
        aria-current={current ? 'true' : undefined}
        onClick={() => onOpen(row.workspaceId, row.cardId)}
      >
        <WorkspaceBadge workspace={workspace} waiting={0} />
        <span className="workspace-text">
          <span className="open-terminal-title" data-testid="open-terminal-title">
            {row.title}
          </span>
          <span className="open-terminal-meta" data-testid="open-terminal-workspace">
            {row.kind === 'shell' ? `${workspace.name} · Shell` : workspace.name}
          </span>
        </span>
        {inWindow && (
          <AppWindow
            className="open-terminal-window"
            data-testid="open-terminal-in-window"
            aria-label="In its own window"
            {...SMALL_ICON}
          />
        )}
        {row.activity && (
          <span
            className={`open-terminal-activity card-activity-${row.activity}`}
            data-testid="open-terminal-activity"
            title={ACTIVITY_LABELS[row.activity]}
            aria-label={ACTIVITY_LABELS[row.activity]}
          />
        )}
      </button>
    </li>
  )
}

export default OpenTerminals
