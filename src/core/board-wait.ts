/**
 * `board wait` (#81 D20): a card's wait ends once it is stopped, waiting for the user or asking;
 * while it works or has no activity it goes on, until its timeout. Plain TS: the renderer gives it
 * the card's state and changes, and a clock.
 */
import type { Activity } from './activity'

/** What `board wait` prints when the card is done or needs someone. */
export type WaitResult = 'stopped' | 'waiting' | 'question'

/** The card's state as the wait reads it. */
export interface WaitedCard {
  running: boolean
  activity: Activity | null | undefined
}

/** The wait's answer for the card as it is now, or null while it goes on. */
export function waitResult(card: WaitedCard): WaitResult | null {
  if (!card.running) return 'stopped'
  if (card.activity === 'waiting' || card.activity === 'question') return card.activity
  return null
}

/** The refusal after `seconds` with no answer. */
export const waitTimedOut = (seconds: number): string => `board: timed out after ${seconds} s`

export interface WaitDeps {
  read(): WaitedCard
  /** Calls the listener on each change of the card's state; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  setTimer(run: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
}

/**
 * Resolves with the card's `waitResult`, checked at once and on each change, or `timeout` after
 * `seconds`; nothing is left subscribed or timed either way. When `signal` aborts (the `board
 * wait` that asked was interrupted) it ends at once as `timeout`, which nobody reads.
 */
export function waitForCard(
  deps: WaitDeps,
  seconds: number,
  signal?: AbortSignal
): Promise<WaitResult | 'timeout'> {
  const now = waitResult(deps.read())
  if (now) return Promise.resolve(now)
  if (signal?.aborted) return Promise.resolve('timeout')
  return new Promise((resolve) => {
    let done = false
    const finish = (result: WaitResult | 'timeout'): void => {
      if (done) return
      done = true
      unsubscribe()
      deps.clearTimer(timer)
      signal?.removeEventListener('abort', cancelled)
      resolve(result)
    }
    const cancelled = (): void => finish('timeout')
    const unsubscribe = deps.subscribe(() => {
      const result = waitResult(deps.read())
      if (result) finish(result)
    })
    const timer = deps.setTimer(() => finish('timeout'), seconds * 1000)
    signal?.addEventListener('abort', cancelled, { once: true })
  })
}
