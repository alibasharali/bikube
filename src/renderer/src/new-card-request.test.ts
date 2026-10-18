import { describe, expect, it } from 'vitest'
import {
  newCardRequestFor,
  pendingNewCardRequest,
  requestNewCard,
  takeNewCardRequest
} from './new-card-request'

describe('new card requests (#40 D9)', () => {
  it("opens the form only on the requested workspace's board, and only with a column", () => {
    requestNewCard('a')
    const pending = pendingNewCardRequest()
    expect(pending?.workspaceId).toBe('a')
    expect(newCardRequestFor(pending, 'a', true)).toBe(pending?.id)
    expect(newCardRequestFor(pending, 'b', true)).toBeUndefined()
    expect(newCardRequestFor(pending, 'a', false)).toBeUndefined()
    expect(newCardRequestFor(null, 'a', true)).toBeUndefined()
  })

  it("a request dropped by another workspace's board never opens the form later", () => {
    requestNewCard('a')
    const pending = pendingNewCardRequest()
    // Another workspace's board mounted first and dropped it.
    if (pending) takeNewCardRequest(pending.id)
    expect(newCardRequestFor(pendingNewCardRequest(), 'a', true)).toBeUndefined()
  })

  it('a newer request is not dropped by taking an older one', () => {
    requestNewCard('a')
    const older = pendingNewCardRequest()
    requestNewCard('b')
    if (older) takeNewCardRequest(older.id)
    expect(pendingNewCardRequest()?.workspaceId).toBe('b')
  })
})
