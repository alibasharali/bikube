import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCommand } from './board-args'
import { NOT_IN_A_CARD } from './board-commands'
import { NO_ANSWER } from './board-client'
import type { BoardRequest } from './board-protocol'
import { BoardRelay, NO_WINDOW } from './board-relay'

interface Win {
  name: string
}

const win: Win = { name: 'main' }
const other: Win = { name: 'other' }
const request: BoardRequest = { v: 1, cardId: 'c1', command: 'move', card: '.', column: 'Done' }

let owners: Map<string, Win | null>
let sent: { owner: Win; requestId: string; cardId: string; command: BoardCommand }[]
let relay: BoardRelay<Win>

beforeEach(() => {
  vi.useFakeTimers()
  owners = new Map([['c1', win]])
  sent = []
  relay = new BoardRelay<Win>(
    (cardId) => owners.get(cardId),
    (owner, requestId, cardId, command) => sent.push({ owner, requestId, cardId, command }),
    1000
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BoardRelay', () => {
  it("forwards a request to the calling card's window and relays its answer (#9 D10)", async () => {
    const reply = relay.handle(request)
    expect(sent).toEqual([
      {
        owner: win,
        requestId: expect.any(String),
        cardId: 'c1',
        command: { command: 'move', card: '.', column: 'Done' }
      }
    ])
    expect(relay.answer(win, sent[0].requestId, { ok: false, error: 'board: x' })).toBe(true)
    await expect(reply).resolves.toEqual({ ok: false, error: 'board: x' })
  })

  it('forwards a status command with its text', () => {
    void relay.handle({ v: 1, cardId: 'c1', command: 'status', card: 'web', text: 'hi' })
    expect(sent[0].command).toEqual({ command: 'status', card: 'web', text: 'hi' })
  })

  it('forwards an activity command with its value (#31 D12)', () => {
    void relay.handle({ v: 1, cardId: 'c1', command: 'activity', card: '.', activity: 'question' })
    expect(sent[0].command).toEqual({ command: 'activity', card: '.', activity: 'question' })
  })

  it('forwards a setup command with its result (#39 D4)', () => {
    void relay.handle({ v: 1, cardId: 'c1', command: 'setup', card: '.', result: 'failed' })
    expect(sent[0].command).toEqual({ command: 'setup', card: '.', result: 'failed' })
  })

  it('refuses a card with no live session without asking any window (#9 D3)', async () => {
    await expect(relay.handle({ ...request, cardId: 'gone' })).resolves.toEqual({
      ok: false,
      error: NOT_IN_A_CARD
    })
    expect(sent).toEqual([])
  })

  it("reports no open window when the card's window is gone (#9 D9)", async () => {
    owners.set('c1', null)
    await expect(relay.handle(request)).resolves.toEqual({ ok: false, error: NO_WINDOW })
    expect(sent).toEqual([])
  })

  it('accepts an answer only from the window asked, once, for an outstanding id (#9 D10)', async () => {
    const reply = relay.handle(request)
    const { requestId } = sent[0]
    expect(relay.answer(other, requestId, { ok: true })).toBe(false)
    expect(relay.answer(win, 'unknown', { ok: true })).toBe(false)
    expect(relay.answer(win, requestId, { ok: true })).toBe(true)
    expect(relay.answer(win, requestId, { ok: false, error: 'late' })).toBe(false)
    await expect(reply).resolves.toEqual({ ok: true })
  })

  it('ignores a malformed answer and keeps waiting', async () => {
    const reply = relay.handle(request)
    const { requestId } = sent[0]
    expect(relay.answer(win, requestId, { ok: 'yes' })).toBe(false)
    expect(relay.answer(win, requestId, { ok: false, error: 42 })).toBe(false)
    expect(relay.answer(win, requestId, { ok: false, error: 'x'.repeat(9000) })).toBe(false)
    expect(relay.answer(win, requestId, null)).toBe(false)
    expect(relay.answer(win, requestId, { ok: false, error: 'board: y', extra: 1 })).toBe(true)
    await expect(reply).resolves.toEqual({ ok: false, error: 'board: y' })
  })

  it('answers no answer when the window does not reply in time (#9 D9)', async () => {
    const reply = relay.handle(request)
    vi.advanceTimersByTime(1000)
    await expect(reply).resolves.toEqual({ ok: false, error: NO_ANSWER })
    expect(relay.answer(win, sent[0].requestId, { ok: true })).toBe(false)
  })

  it("answers no open window for a window's outstanding requests when it goes away", async () => {
    const reply = relay.handle(request)
    relay.release(win)
    await expect(reply).resolves.toEqual({ ok: false, error: NO_WINDOW })
  })

  it("answers no answer at once for a page's pending requests when it reloads or crashes (#9 D9)", async () => {
    const mine = relay.handle(request)
    owners.set('c2', other)
    const theirs = relay.handle({ ...request, cardId: 'c2' })
    relay.releasePage(win)
    await expect(mine).resolves.toEqual({ ok: false, error: NO_ANSWER })
    // The window's new page can't answer a request sent to the old one.
    expect(relay.answer(win, sent[0].requestId, { ok: true })).toBe(false)
    // Another window's requests keep waiting.
    expect(relay.answer(other, sent[1].requestId, { ok: true })).toBe(true)
    await expect(theirs).resolves.toEqual({ ok: true })
  })

  it('answers no open window when sending to the window throws', async () => {
    relay = new BoardRelay<Win>(
      () => win,
      () => {
        throw new Error('destroyed')
      },
      1000
    )
    await expect(relay.handle(request)).resolves.toEqual({ ok: false, error: NO_WINDOW })
  })
})
