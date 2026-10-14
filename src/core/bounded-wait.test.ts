import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boundedWait } from './bounded-wait'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Whether `promise` has settled once pending microtasks have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(() => (done = true))
  await vi.advanceTimersByTimeAsync(0)
  return done
}

describe('boundedWait (#26 D4, D5)', () => {
  it('resolves after `ms` when the promise never settles', async () => {
    const waited = boundedWait(new Promise(() => {}), 1000)
    await vi.advanceTimersByTimeAsync(999)
    expect(await settled(waited)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(waited)).toBe(true)
  })

  it('resolves at once when the promise settles first, and leaves no timer behind', async () => {
    let resolve: () => void = () => {}
    const waited = boundedWait(new Promise<void>((r) => (resolve = r)), 1000)
    await vi.advanceTimersByTimeAsync(10)
    resolve()
    expect(await settled(waited)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves when the promise rejects', async () => {
    const waited = boundedWait(Promise.reject(new Error('no')), 1000)
    expect(await settled(waited)).toBe(true)
  })
})
