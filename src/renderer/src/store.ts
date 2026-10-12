import { useSyncExternalStore } from 'react'
import { InMemoryWorkspaceStore, type WorkspaceState } from '../../core/workspace-store'

/** The app-wide in-memory store (D4). Persistence can replace it behind the same interface. */
export const workspaceStore = new InMemoryWorkspaceStore()

export function useWorkspaceState(): WorkspaceState {
  return useSyncExternalStore(
    (listener) => workspaceStore.subscribe(listener),
    () => workspaceStore.getState()
  )
}
