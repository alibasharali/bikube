import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Activity } from '../../core/activity'
import { openTerminals, type OpenTerminal } from '../../core/open-terminals'
import { shellCards } from '../../core/workspace-shells'
import type { Workspace } from '../../core/workspace-store'
import { useOpenedVersion, wasOpened } from './background-shells'
import { cardTerminals } from './card-terminals'

/** Every card's and shell's id in `workspaces`. */
function terminalIds(workspaces: readonly Workspace[]): string[] {
  return workspaces.flatMap((w) => [...w.cards.map((c) => c.id), ...shellCards(w).map((s) => s.id)])
}

const isRunning = (cardId: string): boolean => cardTerminals().runState(cardId)?.kind === 'running'
const activityOf = (cardId: string): Activity | undefined =>
  cardTerminals().status(cardId)?.activity

/**
 * The running cards and shells by workspace id, following starts, exits and activity changes but
 * not each output chunk: the snapshot is a string that changes only when one of those does. A
 * background shell shows once it has been opened.
 */
export function useOpenTerminals(
  workspaces: readonly Workspace[]
): ReadonlyMap<string, OpenTerminal[]> {
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
  const openedVersion = useOpenedVersion()
  return useMemo(() => {
    const byWorkspace = new Map<string, OpenTerminal[]>()
    for (const row of openTerminals(workspaces, isRunning, activityOf, wasOpened)) {
      byWorkspace.set(row.workspaceId, [...(byWorkspace.get(row.workspaceId) ?? []), row])
    }
    return byWorkspace
    // `key` stands for the running states and activities read here, `openedVersion` for opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, key, openedVersion])
}
