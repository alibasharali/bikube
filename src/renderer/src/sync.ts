import { useSyncExternalStore } from 'react'
import type { SyncStatus } from '../../core/sync-status'
import { workspaceStore } from './store'

/** Main's sync status in the renderer (#13 D13), kept current from `sync.onStatus`. */
let status: SyncStatus = { kind: 'off' }
const listeners = new Set<() => void>()

function setStatus(next: SyncStatus): void {
  status = next
  for (const listener of [...listeners]) listener()
}

/**
 * Follows main's sync status, then loads it once before the first render; a change that arrives
 * meanwhile wins over the loaded one.
 */
export async function loadSyncStatus(): Promise<void> {
  let changed = false
  window.drovr.sync.onStatus((next) => {
    changed = true
    setStatus(next)
  })
  const loaded = await window.drovr.sync.status()
  if (!changed) setStatus(loaded)
}

/** Applies every board main hands over (#13 D9, D14) to the store, which saves it as any change. */
export function listenForSyncBoards(): void {
  window.drovr.sync.onBoard((workspaces) => workspaceStore.replaceBoard(workspaces))
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status
  )
}
