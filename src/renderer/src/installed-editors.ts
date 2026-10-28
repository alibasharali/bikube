import { useSyncExternalStore } from 'react'
import type { NamedEditor } from '../../core/editor-candidates'
import { onAnyWindowFocus } from './window-focus'

/**
 * Which of VS Code, Cursor and Zed are installed (#70 D2), for Settings > Editor: asked of main at
 * launch and again on window focus (at most every 30 s), as the installed agents are. Null until
 * known or when the check failed: then nothing reads as not installed.
 */

const RECHECK_MS = 30_000

let installed: ReadonlySet<NamedEditor> | null = null
let lastCheck = -Infinity
let started = false
const listeners = new Set<() => void>()

const same = (a: ReadonlySet<NamedEditor> | null, b: ReadonlySet<NamedEditor> | null): boolean =>
  a === b || (a !== null && b !== null && a.size === b.size && [...a].every((e) => b.has(e)))

function check(): void {
  if (Date.now() - lastCheck < RECHECK_MS) return
  lastCheck = Date.now()
  void window.bikube.editors.installed().then(
    (list) => {
      const next = list ? new Set(list) : null
      if (same(next, installed)) return
      installed = next
      for (const listener of listeners) listener()
    },
    () => {}
  )
}

/** Starts the checks; called once, before the first render. */
export function startInstalledEditors(): void {
  if (started) return
  started = true
  check()
  onAnyWindowFocus(check)
}

/** The installed editors, re-rendering as that changes; null while unknown. */
export function useInstalledEditors(): ReadonlySet<NamedEditor> | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => installed
  )
}
