import { useSyncExternalStore } from 'react'
import { applySyncBoard } from '../../core/sync-apply'
import type { SyncStatus } from '../../core/sync-status'
import type { Workspace } from '../../core/workspace-store'
import { disposeCard } from './card-actions'
import { cardTerminals } from './card-terminals'
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

/**
 * Applies a board main hands over (#13 D7, D9, D14) to the store, which saves it as any change:
 * cards running here stay (D8) and local cards keep this machine's `claudeStarted` (D6) and
 * `startedAgents` (#21 D7). Nothing is stopped; a card that is gone had no process, and its stale
 * screen is freed.
 */
function applyBoard(incoming: Workspace[]): void {
  const terminals = cardTerminals()
  const before = workspaceStore.getState().workspaces
  const isRunning = (id: string): boolean => terminals.runState(id)?.kind === 'running'
  workspaceStore.replaceBoard(applySyncBoard(incoming, before, isRunning))
  const now = new Set(workspaceStore.getState().workspaces.flatMap((w) => w.cards.map((c) => c.id)))
  for (const w of before) for (const c of w.cards) if (!now.has(c.id)) disposeCard(c.id)
}

/** A board that arrived before the store was loaded, applied once it is. */
let early: Workspace[] | null = null
let ready = false

/**
 * Listens for boards from main from the start, before the store is loaded, so none is missed;
 * `listenForSyncBoards` applies the latest early one and every later one.
 */
export function receiveSyncBoards(): void {
  window.drovr.sync.onBoard((workspaces) => {
    if (ready) applyBoard(workspaces)
    else early = workspaces
  })
}

/** Once the store is loaded: applies the board that arrived meanwhile, and every later one. */
export function listenForSyncBoards(): void {
  ready = true
  if (early !== null) applyBoard(early)
  early = null
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
