import { useSyncExternalStore } from 'react'

/**
 * A request to open the New card form of a workspace's first column (#40 D9), made by the command
 * palette and taken by that workspace's board when it shows: `id` grows with each request.
 */
interface NewCardRequest {
  workspaceId: string
  id: number
}

let request: NewCardRequest | null = null
let nextId = 1
const listeners = new Set<() => void>()

const notify = (): void => listeners.forEach((listener) => listener())

/** Asks the board of `workspaceId` to open its first column's New card form. */
export function requestNewCard(workspaceId: string): void {
  request = { workspaceId, id: nextId++ }
  notify()
}

/** Forgets request `id` once the board has taken it, so the form never opens again for it. */
export function takeNewCardRequest(id: number): void {
  if (request?.id !== id) return
  request = null
  notify()
}

/** The pending request's id for `workspaceId`'s board, or undefined. */
export function useNewCardRequest(workspaceId: string): number | undefined {
  const pending = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => request
  )
  return pending?.workspaceId === workspaceId ? pending.id : undefined
}
