import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { OpenTerminal } from '../../core/open-terminals'
import { GroupStamps } from '../../core/status-time'

/** How often the shown times are redrawn (#79 D6: at least every 30 s). */
const REDRAW_MS = 30_000

/** A tiny external store: its listeners, called on each change. */
function listenerSet(): { subscribe: (l: () => void) => () => void; notify: () => void } {
  const listeners = new Set<() => void>()
  return {
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    notify: () => listeners.forEach((l) => l())
  }
}

const stamps = new GroupStamps()
let stamped: ReadonlyMap<string, number> = new Map()
const stampListeners = listenerSet()

/** The time the shown ages read, moved on by the redraw timer and by each stamping. */
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
let clockUsers = 0
const clockListeners = listenerSet()

function tick(): void {
  now = Date.now()
  clockListeners.notify()
}

function subscribeClock(listener: () => void): () => void {
  const unsubscribe = clockListeners.subscribe(listener)
  clockUsers += 1
  if (timer === null) {
    now = Date.now()
    timer = setInterval(tick, REDRAW_MS)
  }
  return () => {
    unsubscribe()
    clockUsers -= 1
    if (clockUsers === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * When each running card's or shell's Split sidebar group last changed, by card id (#79 D6), its
 * start counting as a change: `rows` is every running row, so one missing has stopped and is
 * forgotten. Runtime only. Stamped before paint each time the rows change (starts, stops and
 * activity), moving the shown ages' clock on too.
 */
export function useGroupStamps(rows: readonly OpenTerminal[]): ReadonlyMap<string, number> {
  useLayoutEffect(() => {
    const next = stamps.update(rows, Date.now())
    tick()
    if (next === stamped) return
    stamped = next
    stampListeners.notify()
  }, [rows])
  return useSyncExternalStore(stampListeners.subscribe, () => stamped)
}

/** The clock the shown ages read, redrawn every 30 s while any is shown. */
export function useRedrawClock(): number {
  return useSyncExternalStore(subscribeClock, () => now)
}
