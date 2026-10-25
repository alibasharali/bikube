import { defaultShellId } from '../../core/workspace-store'
import { removeShell } from './card-actions'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * The New shell shortcut's shells (#66 D1, D2): the Default shell while it isn't running, else a
 * new temporary plain shell, removed from its workspace as soon as it stops.
 */

const running = (id: string): boolean => cardTerminals().runState(id)?.kind === 'running'

/**
 * The shell the New shell shortcut (and its palette row) opens in the workspace (D1): its Default
 * shell while that isn't running, else a temporary shell added now (D2, D3). Null for no
 * workspace.
 */
export function newShell(workspaceId: string): string | null {
  const defaultId = defaultShellId(workspaceId)
  if (!running(defaultId)) return defaultId
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
