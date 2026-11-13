import { removeShell } from './card-actions'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * The New shell shortcut's shells (#66 D2, #81 D2): always a new temporary plain shell, removed from
 * its workspace as soon as it stops.
 */

const running = (id: string): boolean => cardTerminals().runState(id)?.kind === 'running'

/**
 * The shell the New shell shortcut (and its palette row) opens in the workspace: a temporary
 * `Terminal N` added now (#81 D2). Null for no workspace.
 */
export function newShell(workspaceId: string): string | null {
  const added = workspaceStore.createTemporaryShell(workspaceId)
  return added.ok ? added.value.id : null
}

let started = false

/** Removes each temporary shell once it stops (D2); called once, before the first render. */
export function startTemporaryShells(): void {
  if (started) return
  started = true
  cardTerminals().onEnded((shellId) => {
    // After every other listener has seen it end. A restart (Restart in its menu) starts it again
    // at once, and then it stays.
    queueMicrotask(() => {
      if (running(shellId)) return
      for (const workspace of workspaceStore.getState().workspaces) {
        if (workspace.shells.some((s) => s.id === shellId && s.temporary)) {
          removeShell(workspace.id, shellId)
          return
        }
      }
    })
  })
}
