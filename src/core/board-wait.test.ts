import { describe, expect, it } from 'vitest'
import type { Activity } from './activity'
import { SendMarks, waitForCard, waitResult, waitTimedOut, type WaitedCard } from './board-wait'

describe('waitResult (#81 D20)', () => {
  it('is stopped, waiting or question, and nothing while working or with no activity', () => {
    expect(waitResult({ running: false, activity: 'working' })).toBe('stopped')
    expect(waitResult({ running: true, activity: 'waiting' })).toBe('waiting')
    expect(waitResult({ running: true, activity: 'question' })).toBe('question')
    expect(waitResult({ running: true, activity: 'working' })).toBeNull()
    expect(waitResult({ running: true, activity: null })).toBeNull()
  })

  it('reads a waiting or question set before the last send as nothing, a stopped card still stopped', () => {
    expect(waitResult({ running: true, activity: 'waiting', stale: true })).toBeNull()
    expect(waitResult({ running: true, activity: 'question', stale: true })).toBeNull()
    expect(waitResult({ running: false, activity: 'waiting', stale: true })).toBe('stopped')
  })
})

describe('waiting after board send (#81 D19, D20)', () => {
  /** Card `id` running with `activity`, read through `marks` as the renderer does. */
  function card(
    marks: SendMarks,
    id: string,
    activity: Activity | null
  ): {
    deps: Parameters<typeof waitForCard>[0]
    fake: ReturnType<typeof fakeCard>
    setActivity(next: Activity | null): void
    stop(): void
  } {
    let state: { running: boolean; activity: Activity | null } = { running: true, activity }
    const fake = fakeCard({ ...state, stale: marks.stale(id) })
    const deps = {
      ...fake.deps,
      read: (): WaitedCard => ({ ...state, stale: marks.stale(id) }),
      subscribe: (listener: () => void): (() => void) => {
        const off = fake.deps.subscribe(listener)
        const offMarks = marks.subscribe(id, listener)
        return () => {
          off()
          offMarks()
        }
      }
    }
    return {
      deps,
      fake,
      /** `board activity <id> <activity>`: the card's activity set, the same value too. */
      setActivity(next: Activity | null) {
        marks.activitySet(id)
        if (next !== state.activity) {
          state = { ...state, activity: next }
          fake.set(state.running, next)
        }
      },
      stop() {
        state = { running: false, activity: null }
        fake.set(false, null)
      }
    }
  }

  it("makes the card's current waiting stale, until its activity is set again, waiting too", async () => {
    const marks = new SendMarks()
    const review = card(marks, 'review', 'waiting')
    expect(await waitForCard(review.deps, 5)).toBe('waiting')
    marks.sent('review')
    let result: string | undefined
    void waitForCard(review.deps, 5).then((r) => (result = r))
    await Promise.resolve()
    expect(result).toBeUndefined()
    review.setActivity('waiting')
    await Promise.resolve()
    expect(result).toBe('waiting')
    expect(review.fake.listeners.size).toBe(0)
  })

  it('answers the activity set after the send: working goes on, then question', async () => {
    const marks = new SendMarks()
    const review = card(marks, 'review', 'question')
    marks.sent('review')
    const done = waitForCard(review.deps, 5)
    review.setActivity('working')
    review.setActivity('question')
    expect(await done).toBe('question')
  })

  it('still answers stopped at once after a send', async () => {
    const marks = new SendMarks()
    const review = card(marks, 'review', 'waiting')
    marks.sent('review')
    review.stop()
    expect(await waitForCard(review.deps, 5)).toBe('stopped')
  })

  it('answers stopped when the card stops while its waiting is stale', async () => {
    const marks = new SendMarks()
    const review = card(marks, 'review', 'waiting')
    marks.sent('review')
    const done = waitForCard(review.deps, 5)
    review.stop()
    expect(await done).toBe('stopped')
  })

  it("leaves another card's waiting as it is", async () => {
    const marks = new SendMarks()
    const other = card(marks, 'other', 'waiting')
    card(marks, 'review', 'waiting')
    marks.sent('review')
    expect(marks.stale('other')).toBe(false)
    expect(await waitForCard(other.deps, 5)).toBe('waiting')
  })

  it('reads nothing as stale before any send', () => {
    const marks = new SendMarks()
    expect(marks.stale('review')).toBe(false)
    marks.sent('review')
    expect(marks.stale('review')).toBe(true)
  })
})

/** A card whose state the test changes, and a clock it moves. */
function fakeCard(initial: WaitedCard): {
  set(running: boolean, activity: Activity | null): void
  tick(ms: number): void
  listeners: Set<() => void>
  timers: () => number
  deps: Parameters<typeof waitForCard>[0]
} {
  let card = initial
  let now = 0
  const listeners = new Set<() => void>()
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextTimer = 1
  return {
    listeners,
    timers: () => timers.size,
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

  it('stops waiting when cancelled, its client gone, unsubscribed and with no timer left', async () => {
    const fake = fakeCard({ running: true, activity: 'working' })
    const gone = new AbortController()
    const done = waitForCard(fake.deps, 3600, gone.signal)
    expect(fake.listeners.size).toBe(1)
    expect(fake.timers()).toBe(1)
    gone.abort()
    expect(await done).toBe('timeout')
    expect(fake.listeners.size).toBe(0)
    expect(fake.timers()).toBe(0)
  })

  it('subscribes to nothing when already cancelled', async () => {
    const fake = fakeCard({ running: true, activity: 'working' })
    const gone = new AbortController()
    gone.abort()
    expect(await waitForCard(fake.deps, 5, gone.signal)).toBe('timeout')
    expect(fake.listeners.size).toBe(0)
    expect(fake.timers()).toBe(0)
  })

  it('words the timeout as D20 does', () => {
    expect(waitTimedOut(5)).toBe('board: timed out after 5 s')
  })
})
