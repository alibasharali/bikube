import { useSyncExternalStore } from 'react'
import { InMemoryWorkspaceStore, type WorkspaceState } from '../../core/workspace-store'

/**
 * A store that starts from `initialState` (#8 D5), sends the whole state to `save` on every
 * change (#8 D6) and gives new workspaces, columns and cards UUIDs, so they never collide with
 * restored ids (#8 D8).
 */
export function createWorkspaceStore(
  initialState: WorkspaceState,
  save: (state: WorkspaceState) => void
): InMemoryWorkspaceStore {
  const store = new InMemoryWorkspaceStore({
    initialState,
    generateId: () => crypto.randomUUID(),
    generateSessionId: () => crypto.randomUUID()
  })
  store.subscribe(() => save(store.getState()))
  return store
}

/**
 * The app-wide store (D4), seeded by `loadWorkspaceStore` before the first render. Importers read
 * this live binding at call time, never at module load.
 */
export let workspaceStore: InMemoryWorkspaceStore

/** Loads the saved state from main once and creates the app-wide store from it (#8 D5). */
export async function loadWorkspaceStore(): Promise<void> {
  const state = await window.bikube.state.load()
  workspaceStore = createWorkspaceStore(state, (next) => window.bikube.state.save(next))
}

export function useWorkspaceState(): WorkspaceState {
  return useSyncExternalStore(
    (listener) => workspaceStore.subscribe(listener),
    () => workspaceStore.getState()
  )
}
