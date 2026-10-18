import { useSyncExternalStore } from 'react'

/**
 * A request to open the New card form of a workspace's first column (#40 D9), made by the command
 * palette and taken by the next board that shows: `id` grows with each request.
 */
export interface NewCardRequest {
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

/** Forgets request `id` once a board has taken or dropped it, so it never opens the form later. */
export function takeNewCardRequest(id: number): void {
  if (request?.id !== id) return
  request = null
  notify()
}

/** The pending request, for any workspace, or null. */
export function pendingNewCardRequest(): NewCardRequest | null {
  return request
}

/**
 * The id of `pending` when it opens the form on the board of `workspaceId`: it must be for that
 * workspace, which needs a column. Any other pending request is dropped by the board that shows.
 */
export function newCardRequestFor(
  pending: NewCardRequest | null,
  workspaceId: string,
  hasColumns: boolean
): number | undefined {
  return pending?.workspaceId === workspaceId && hasColumns ? pending.id : undefined
}

/** The pending request, for any workspace, following changes. */
export function usePendingNewCardRequest(): NewCardRequest | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, pendingNewCardRequest)
}
