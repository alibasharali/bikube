import { useEffect, useSyncExternalStore } from 'react'
import { onAnyWindowFocus } from './window-focus'

/**
 * The current branch of each local workspace's folder, for the sidebar and the title bar: read
 * when first shown, every few seconds while shown, and when a Bikube window gets the focus (a card's
 * own window too, #53 D10), since the user (or an agent) switches branches in a terminal. One store
 * for every folder shown.
 */

/** A branch name; `detached` for a detached HEAD; null outside a git repository. */
type Branch = string | null

const REFRESH_MS = 4000

const branches = new Map<string, Branch>()
const watched = new Map<string, number>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let stopFocus: (() => void) | null = null

function read(dir: string): void {
  void window.bikube.worktree.info(dir).then((info) => {
    const next = info === null ? null : (info.branch ?? 'detached')
    if (branches.get(dir) === next) return
    branches.set(dir, next)
    for (const listener of [...listeners]) listener()
  })
}

const readAll = (): void => {
  for (const dir of watched.keys()) read(dir)
}

function watch(dir: string): () => void {
  watched.set(dir, (watched.get(dir) ?? 0) + 1)
  if (watched.get(dir) === 1) read(dir)
  if (!timer) {
    timer = setInterval(readAll, REFRESH_MS)
    stopFocus = onAnyWindowFocus(readAll)
  }
  return () => {
    const count = (watched.get(dir) ?? 1) - 1
    if (count > 0) {
      watched.set(dir, count)
      return
    }
    watched.delete(dir)
    if (watched.size === 0 && timer) {
      clearInterval(timer)
      timer = null
      stopFocus?.()
      stopFocus = null
    }
  }
}

/** Reads `dir`'s branch again at once, e.g. after the branch menu ran git there (#33 D13). */
export function refreshBranch(dir: string): void {
  read(dir)
}

/**
 * The branch checked out in `dir` (a local folder): undefined until first read, null when it
 * isn't a repository (or no longer exists) and for no folder.
 */
export function useBranch(dir: string | null): Branch | undefined {
  useEffect(() => (dir ? watch(dir) : undefined), [dir])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (dir ? branches.get(dir) : null)
  )
}
