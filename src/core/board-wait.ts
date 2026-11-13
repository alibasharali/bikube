/**
 * `board wait` (#81 D20): a card's wait ends once it is stopped, waiting for the user or asking;
 * while it works or has no activity it goes on, until its timeout. A `waiting` or `question` set
 * before the last `board send` to the card is stale and doesn't count (`SendMarks`). Plain TS: the
 * renderer gives it the card's state and changes, and a clock.
 */
import type { Activity } from './activity'

/** What `board wait` prints when the card is done or needs someone. */
export type WaitResult = 'stopped' | 'waiting' | 'question'

/** The card's state as the wait reads it. */
export interface WaitedCard {
  running: boolean
  activity: Activity | null | undefined
  /** Its activity was set before the last `board send` to it and not since (D20). */
  stale?: boolean
}

/** The wait's answer for the card as it is now, or null while it goes on. */
export function waitResult(card: WaitedCard): WaitResult | null {
  if (!card.running) return 'stopped'
  if (card.stale) return null
  if (card.activity === 'waiting' || card.activity === 'question') return card.activity
  return null
}

/**
 * Each card's `board activity` sets and its last `board send` (#81 D19, D20): a send makes the
 * card's activity as it is then stale, until the next set (the same value again included), so a
 * wait right after a send never reads the last turn's `waiting`. Runtime only: two numbers per
 * card sent to, kept for the run.
 */
export class SendMarks {
  /** How many times each card's activity was set. */
  private readonly sets = new Map<string, number>()
  /** Each card's count of sets at its last send. */
  private readonly sentAt = new Map<string, number>()
  private readonly listeners = new Map<string, Set<() => void>>()

  /** `board activity` set the card's activity, whatever its value; tells its listeners. */
  activitySet(cardId: string): void {
    this.sets.set(cardId, (this.sets.get(cardId) ?? 0) + 1)
    for (const listener of [...(this.listeners.get(cardId) ?? [])]) listener()
  }

  /** `board send` typed into the card: its activity now predates the send. */
  sent(cardId: string): void {
    this.sentAt.set(cardId, this.sets.get(cardId) ?? 0)
  }

  /** Whether the card's activity was last set before its last send. */
  stale(cardId: string): boolean {
    const at = this.sentAt.get(cardId)
    return at !== undefined && at === (this.sets.get(cardId) ?? 0)
  }

  /** Calls `listener` on each set of the card's activity; returns an unsubscribe function. */
  subscribe(cardId: string, listener: () => void): () => void {
    const set = this.listeners.get(cardId) ?? new Set()
    set.add(listener)
    this.listeners.set(cardId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.listeners.get(cardId) === set) this.listeners.delete(cardId)
    }
  }
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
