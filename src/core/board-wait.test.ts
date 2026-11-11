import { describe, expect, it } from 'vitest'
import type { Activity } from './activity'
import { waitForCard, waitResult, waitTimedOut, type WaitedCard } from './board-wait'

describe('waitResult (#81 D20)', () => {
  it('is stopped, waiting or question, and nothing while working or with no activity', () => {
    expect(waitResult({ running: false, activity: 'working' })).toBe('stopped')
    expect(waitResult({ running: true, activity: 'waiting' })).toBe('waiting')
    expect(waitResult({ running: true, activity: 'question' })).toBe('question')
    expect(waitResult({ running: true, activity: 'working' })).toBeNull()
    expect(waitResult({ running: true, activity: null })).toBeNull()
  })
})

/** A card whose state the test changes, and a clock it moves. */
function fakeCard(initial: WaitedCard): {
  set(running: boolean, activity: Activity | null): void
  tick(ms: number): void
  listeners: Set<() => void>
  deps: Parameters<typeof waitForCard>[0]
} {
  let card = initial
  let now = 0
  const listeners = new Set<() => void>()
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextTimer = 1
  return {
    listeners,
    set(running, activity) {
      card = { running, activity }
      for (const listener of [...listeners]) listener()
    },
    tick(ms) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
    deps: {
      read: () => card,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      setTimer: (run, ms) => {
        const id = nextTimer++
        timers.set(id, { at: now + ms, run })
        return id
      },
      clearTimer: (id) => timers.delete(id as number)
    }
  }
}

describe('waitForCard (#81 D20)', () => {
  it('answers at once when the card already stopped, waits or asks', async () => {
    for (const [card, result] of [
      [{ running: false, activity: null }, 'stopped'],
      [{ running: true, activity: 'waiting' }, 'waiting'],
      [{ running: true, activity: 'question' }, 'question']
    ] as const) {
      const fake = fakeCard(card)
      expect(await waitForCard(fake.deps, 5)).toBe(result)
      expect(fake.listeners.size).toBe(0)
    }
  })

  it('keeps waiting while it works, then answers on the change, unsubscribed', async () => {
    const fake = fakeCard({ running: true, activity: null })
    const done = waitForCard(fake.deps, 600)
    fake.set(true, 'working')
    fake.tick(599_000)
    fake.set(true, 'waiting')
    expect(await done).toBe('waiting')
    expect(fake.listeners.size).toBe(0)
    fake.tick(10_000)
  })

  it('answers stopped when the card stops while it works', async () => {
    const fake = fakeCard({ running: true, activity: 'working' })
    const done = waitForCard(fake.deps, 600)
    fake.set(false, null)
    expect(await done).toBe('stopped')
  })

  it('times out after the given seconds with no change, unsubscribed', async () => {
    const fake = fakeCard({ running: true, activity: 'working' })
    let result: string | undefined
    void waitForCard(fake.deps, 5).then((r) => (result = r))
    fake.tick(4999)
    await Promise.resolve()
    expect(result).toBeUndefined()
    fake.tick(1)
    await Promise.resolve()
    expect(result).toBe('timeout')
    expect(fake.listeners.size).toBe(0)
  })

  it('words the timeout as D20 does', () => {
    expect(waitTimedOut(5)).toBe('board: timed out after 5 s')
  })
})
