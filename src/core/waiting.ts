/**
 * Cards and shells waiting for the user (#41 D1, D2): their activity is Waiting for you or Needs
 * your answer. The queue holds their ids oldest first: each joins at the end as it begins
 * waiting, so its place is its waiting since, ties in the order the activities arrived. Runtime
 * only, never saved. Plain TS.
 */
import type { Activity } from './activity'
import { defaultShellId, type Workspace } from './workspace-store'

/** The activities that mean the card waits for the user (D1). */
export const isWaiting = (activity: Activity | null): boolean =>
  activity === 'waiting' || activity === 'question'

/**
 * The queue after card `id`'s activity changed to `activity` (null for none, or a stop or start):
 * it joins the end as it begins waiting, keeps its place between waiting and question, and
 * leaves on anything else. The same array when nothing changes.
 */
export function withActivity(
  queue: readonly string[],
  id: string,
  activity: Activity | null
): readonly string[] {
  const queued = queue.includes(id)
  if (isWaiting(activity)) return queued ? queue : [...queue, id]
  return queued ? queue.filter((q) => q !== id) : queue
}

/**
 * The card or shell to open next (D4): the one after the open one in the queue, wrapping to the
 * first, when the open one waits; otherwise the first. Null when none waits, or only the open one.
 */
export function nextWaiting(queue: readonly string[], openId: string | null): string | null {
  if (queue.length === 0) return null
  const at = openId === null ? -1 : queue.indexOf(openId)
  if (at === -1) return queue[0]
  if (queue.length === 1) return null
  return queue[(at + 1) % queue.length]
}

/** Each card's and shell's workspace id, the Default shell (never stored) included. */
function owners(workspaces: readonly Workspace[]): Map<string, string> {
  const owner = new Map<string, string>()
  for (const w of workspaces) {
    owner.set(defaultShellId(w.id), w.id)
    for (const s of w.shells) owner.set(s.id, w.id)
    for (const c of w.cards) owner.set(c.id, w.id)
  }
  return owner
}

/** How many cards and shells wait in each workspace (D6); a workspace with none is absent. */
export function waitingCounts(
  queue: readonly string[],
  workspaces: readonly Workspace[]
): Map<string, number> {
  const owner = owners(workspaces)
  const counts = new Map<string, number>()
  for (const id of queue) {
    const workspaceId = owner.get(id)
    if (workspaceId !== undefined) counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1)
  }
  return counts
}

/** The queue without the cards and shells no longer in any workspace (D1); the same when none. */
export function withoutDeleted(
  queue: readonly string[],
  workspaces: readonly Workspace[]
): readonly string[] {
  const owner = owners(workspaces)
  const kept = queue.filter((id) => owner.has(id))
  return kept.length === queue.length ? queue : kept
}
