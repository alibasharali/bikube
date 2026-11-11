import { useSyncExternalStore } from 'react'
import { CLAUDE_RETENTION_DAYS, type ClaudeRetention } from '../../core/claude-retention-types'

/**
 * Claude Code's conversation retention as the card view's notice uses it (#80 D5): main's last read
 * of `cleanupPeriodDays`, taken when a local Claude Code card is opened at most every 30 s; whether
 * Not now hid the notice for this run of the app; and the last failed write's error line. One for
 * the whole app: every card view, in the main window and card windows, shows the same.
 */

const REREAD_MS = 30_000

export interface RetentionState {
  /** Main's last read; null before the first one answers. */
  retention: ClaudeRetention | null
  /** Not now was clicked: no notice for the rest of this run, on every card. */
  dismissed: boolean
  /** A Keep for 10 years write is running. */
  saving: boolean
  /** The last failed write's line (D4), until the next write. */
  error: string | null
}

let state: RetentionState = { retention: null, dismissed: false, saving: false, error: null }
let lastRead = -Infinity
const listeners = new Set<() => void>()

function update(change: Partial<RetentionState>): void {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
}

/** Reads the setting again unless it was read in the last 30 s (D5). */
export function checkClaudeRetention(): void {
  if (Date.now() - lastRead < REREAD_MS) return
  lastRead = Date.now()
  void window.bikube.claudeRetention.read().then(
    (retention) => update({ retention }),
    () => {}
  )
}

/**
 * Keep for 10 years (D4, D5): main sets `cleanupPeriodDays` to 3650; on success the setting reads
 * ok, else the error line shows. Resolves with the outcome's error line, null on success.
 */
export async function keepClaudeConversations(): Promise<string | null> {
  update({ saving: true, error: null })
  let error: string | null
  try {
    const result = await window.bikube.claudeRetention.set()
    error = result.ok ? null : result.message
  } catch (e) {
    error = `Couldn't save settings.json: ${(e as Error).message}`
  }
  update(
    error === null
      ? { saving: false, error: null, retention: { state: 'ok', days: CLAUDE_RETENTION_DAYS } }
      : { saving: false, error }
  )
  return error
}

/** Not now (D5): hidden for the rest of this run of the app, on every card. */
export function dismissClaudeRetention(): void {
  update({ dismissed: true, error: null })
}

/** The notice's state, re-rendering as it changes. */
export function useClaudeRetention(): RetentionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
