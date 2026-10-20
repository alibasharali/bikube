import { useSyncExternalStore } from 'react'
import type { AgentChoice } from '../../core/installed-agents'
import { onAnyWindowFocus } from './window-focus'

/**
 * Which agent CLIs are installed, for the startup selects: asked of main at launch and again on
 * window focus (at most every 30 s), so installing one shows without a restart. Null until known
 * or when the check failed: then nothing reads as not installed.
 */

const RECHECK_MS = 30_000

let installed: ReadonlySet<AgentChoice> | null = null
let lastCheck = -Infinity
let started = false
const listeners = new Set<() => void>()

function check(): void {
  if (Date.now() - lastCheck < RECHECK_MS) return
  lastCheck = Date.now()
  void window.drovr.agents.installed().then(
    (list) => {
      const next = list ? new Set(list) : null
      if (
        next &&
        installed &&
        next.size === installed.size &&
        [...next].every((a) => installed?.has(a))
      )
        return
      installed = next
      for (const listener of listeners) listener()
    },
    () => {}
  )
}

/** Starts the checks; called once, before the first render. */
export function startInstalledAgents(): void {
  if (started) return
  started = true
  check()
  onAnyWindowFocus(check)
}

/** The installed agents, re-rendering as that changes; null while unknown. */
export function useInstalledAgents(): ReadonlySet<AgentChoice> | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => installed
  )
}
