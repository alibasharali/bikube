import { useSyncExternalStore } from 'react'
import { startCard } from './card-actions'

/**
 * Background shells (`WorkspaceShell.background`) that were opened since they last started in
 * the background: from then on they are ordinary shells, listed in the sidebar. Runtime only.
 */
const opened = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version++
  for (const listener of [...listeners]) listener()
}

/** The shell was opened (its view or its own window showed it). */
export function markOpened(shellId: string): void {
  if (opened.has(shellId)) return
  opened.add(shellId)
  changed()
}

export function wasOpened(shellId: string): boolean {
  return opened.has(shellId)
}

/** Starts a background shell without opening it: out of the sidebar until it is opened. */
export function startInBackground(workspaceId: string, shellId: string): void {
  if (opened.delete(shellId)) changed()
  startCard(workspaceId, shellId)
}

export function subscribeOpened(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Bumped on every change, for hooks reading many shells. */
export function useOpenedVersion(): number {
  return useSyncExternalStore(subscribeOpened, () => version)
}
