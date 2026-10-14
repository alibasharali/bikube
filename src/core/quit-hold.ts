export interface QuitState {
  /** Quits held so far. */
  holds: number
  /** Whether any card's shell is still running. */
  liveShells: boolean
  /** Whether the sync folder has a pending board or a queued or running operation. */
  syncBusy: boolean
}

/** Whether to hold a quit and, when held, whether it waits for the shells to exit too. */
export type QuitHold = { hold: false } | { hold: true; shells: boolean }

/**
 * Decides a quit (#18 D2, #26 D5). The first is held while shells are live (waiting for them to
 * exit, and for the sync folder's flush) or the sync folder is busy (waiting for its flush). A
 * later one (the caller SIGKILLs any shells left) is held once more only while the sync folder is
 * still busy; a third goes through. Each hold is bounded by the caller (`QUIT_WAIT_MS`).
 */
export function quitHold({ holds, liveShells, syncBusy }: QuitState): QuitHold {
  if (holds === 0 && (liveShells || syncBusy)) return { hold: true, shells: liveShells }
  if (holds === 1 && syncBusy) return { hold: true, shells: false }
  return { hold: false }
}

/**
 * Whether main SIGKILLs its own process once the app is quitting (#26 D5): the sync folder is
 * still busy, so a libuv worker may be blocked in a stalled fs call, and libuv waits for its pool
 * threads at exit, so the process would never end (keeping the single-instance lock, #8 D12).
 * Never on Windows, where signals aren't passed (#18).
 */
export function killAtQuit({
  syncBusy,
  platform
}: {
  syncBusy: boolean
  platform: NodeJS.Platform
}): boolean {
  return syncBusy && platform !== 'win32'
}
