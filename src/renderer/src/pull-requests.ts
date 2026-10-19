import { useEffect, useSyncExternalStore } from 'react'
import type { PullRequestStatus } from '../../core/pr-status'
import { anyWindowFocused, onAnyWindowFocus } from './window-focus'

/**
 * Each shown worktree card's pull request, as the user's `gh` sees it (#38 D7, D9), kept outside
 * any card component (the board remounts cards on moves and workspace switches), by the card's
 * worktree folder. A card's PR is read when it is first shown, every 60 s while a Drovr window is
 * focused, when one gets the focus (a card's own window counts, #53 D10), right after Open pull
 * request succeeds and when its live branch changes; one read at a time per card, a read's result
 * kept only while the branch it was read for is still the card's live branch. Never read while no
 * Drovr window is focused.
 */

/** How often a shown card's PR is read while the window is focused (D9). */
export const PR_REFRESH_MS = 60_000

interface Known {
  /** The branch the PR was read for. */
  branch: string
  pr: PullRequestStatus | null
}

const known = new Map<string, Known>()
/** Each shown folder's live branch (as `useBranch` reads it) and how many cards show it. */
const watched = new Map<string, { branch: string | null; count: number }>()
const reading = new Set<string>()
/** Folders to read again once their running read ends (a request made meanwhile). */
const again = new Set<string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let stopFocus: (() => void) | null = null

const notify = (): void => {
  for (const listener of [...listeners]) listener()
}

function read(dir: string): void {
  if (!watched.get(dir)?.branch) return
  if (reading.has(dir)) {
    again.add(dir)
    return
  }
  reading.add(dir)
  void window.drovr.git
    .pullRequest(dir)
    .catch(() => null)
    .then((result) => {
      reading.delete(dir)
      const live = watched.get(dir)?.branch
      // Kept only for the branch the card is still on (D9); a read for another one is dropped.
      if (result !== null && live === result.branch) {
        const before = known.get(dir)
        if (JSON.stringify(before) !== JSON.stringify(result)) {
          known.set(dir, { branch: result.branch, pr: result.pr })
          notify()
        }
      }
      if (again.delete(dir)) read(dir)
    })
}

const readAll = (): void => {
  for (const dir of watched.keys()) read(dir)
}

const readIfFocused = (): void => {
  if (anyWindowFocused()) readAll()
}

function watch(dir: string, branch: string | null): () => void {
  const entry = watched.get(dir)
  if (!entry) watched.set(dir, { branch, count: 1 })
  else entry.count += 1
  // First shown, or its live branch changed; another component showing the same card reads nothing.
  if (!entry || entry.branch !== branch) {
    if (entry) entry.branch = branch
    read(dir)
  }
  if (!timer) {
    timer = setInterval(readIfFocused, PR_REFRESH_MS)
    stopFocus = onAnyWindowFocus(readAll)
  }
  return () => {
    const current = watched.get(dir)
    if (!current) return
    current.count -= 1
    if (current.count > 0) return
    watched.delete(dir)
    if (watched.size === 0 && timer) {
      clearInterval(timer)
      timer = null
      stopFocus?.()
      stopFocus = null
    }
  }
}

/** Reads `dir`'s PR again at once (after Open pull request succeeds, D9). */
export function refreshPullRequest(dir: string): void {
  read(dir)
}

/**
 * The PR of the worktree `dir` on its live `branch` (from `useBranch`): null for none, not read
 * yet, or a detached HEAD (`'detached'`). Each component using it keeps the card's PR read.
 */
export function usePullRequest(
  dir: string,
  branch: string | null | undefined
): PullRequestStatus | null {
  const live = typeof branch === 'string' && branch !== 'detached' ? branch : null
  useEffect(() => watch(dir, live), [dir, live])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => {
      const entry = known.get(dir)
      return entry && live !== null && entry.branch === live ? entry.pr : null
    }
  )
}
