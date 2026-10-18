import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTE_MS,
  cardGitAction,
  dismissCardGitAction,
  runCardGitAction,
  subscribeCardGitActions
} from './card-git'

/** A command that ends when `finish` is called with its result. */
function pending<T>(): { command: () => Promise<T>; finish: (result: T) => void } {
  let finish!: (result: T) => void
  const promise = new Promise<T>((resolve) => {
    finish = resolve
  })
  return { command: () => promise, finish }
}

let n = 0
let card: string
beforeEach(() => {
  vi.useFakeTimers()
  card = `card-${n++}`
})
afterEach(() => {
  vi.useRealTimers()
})

describe('runCardGitAction', () => {
  it('is busy while it runs, ignores a second request, then shows its note for 10 s', async () => {
    const push = pending<{ ok: true; note: string }>()
    const changes = vi.fn()
    const unsubscribe = subscribeCardGitActions(changes)
    const first = runCardGitAction(card, 'Pushing…', push.command)
    expect(cardGitAction(card)).toEqual({ busy: 'Pushing…', error: null, note: null })
    expect(cardGitAction('other').busy).toBeNull()
    const second = vi.fn()
    expect(await runCardGitAction(card, 'Merging…', second)).toBeNull()
    expect(second).not.toHaveBeenCalled()

    push.finish({ ok: true, note: 'Pushed · opened in the browser' })
    expect(await first).toEqual({ ok: true, note: 'Pushed · opened in the browser' })
    expect(cardGitAction(card)).toEqual({
      busy: null,
      error: null,
      note: 'Pushed · opened in the browser'
    })
    expect(changes).toHaveBeenCalled()
    vi.advanceTimersByTime(NOTE_MS - 1)
    expect(cardGitAction(card).note).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(cardGitAction(card)).toEqual({ busy: null, error: null, note: null })
    unsubscribe()
  })

  it("keeps git's message until dismissed or the next action, and a thrown call's", async () => {
    await runCardGitAction(card, 'Pushing…', async () => ({ ok: false, reason: 'rejected' }))
    vi.advanceTimersByTime(NOTE_MS * 2)
    expect(cardGitAction(card)).toEqual({ busy: null, error: 'rejected', note: null })
    dismissCardGitAction(card)
    expect(cardGitAction(card).error).toBeNull()

    await runCardGitAction(card, 'Pushing…', async () => {
      throw new Error('gone')
    })
    expect(cardGitAction(card).error).toBe('gone')
    const next = pending<{ ok: true; note: string }>()
    const running = runCardGitAction(card, 'Pushing…', next.command)
    expect(cardGitAction(card)).toEqual({ busy: 'Pushing…', error: null, note: null })
    next.finish({ ok: true, note: 'done' })
    await running
  })

  it("a new action's note isn't cut short by the last one's timer", async () => {
    await runCardGitAction(card, 'Pushing…', async () => ({ ok: true, note: 'one' }))
    vi.advanceTimersByTime(NOTE_MS - 100)
    await runCardGitAction(card, 'Pushing…', async () => ({ ok: true, note: 'two' }))
    vi.advanceTimersByTime(200)
    expect(cardGitAction(card).note).toBe('two')
  })
})
