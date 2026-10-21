import { describe, expect, it, vi } from 'vitest'
import type { ClaudeUsage } from '../../core/claude-usage-types'
import { cardUsage, clearCardUsage, setCardUsage, subscribeUsage } from './usage'

// Each card's Claude Code usage, runtime only (#50 D7).

const usage = (tokens: number): ClaudeUsage => ({
  input: tokens,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens,
  context: tokens,
  model: 'claude-sonnet-4-5'
})

describe('card usage', () => {
  it('keeps the latest report per card and tells subscribers', () => {
    const changes = vi.fn()
    const unsubscribe = subscribeUsage(changes)
    setCardUsage('a', usage(10))
    setCardUsage('a', usage(20))
    setCardUsage('b', usage(5))
    expect(cardUsage('a')).toEqual(usage(20))
    expect(cardUsage('b')).toEqual(usage(5))
    expect(cardUsage('c')).toBeUndefined()
    expect(changes).toHaveBeenCalledTimes(3)
    unsubscribe()
    setCardUsage('a', usage(30))
    expect(changes).toHaveBeenCalledTimes(3)
  })

  it('forgets a card on a zero report and when it is cleared (deleted)', () => {
    setCardUsage('z', usage(10))
    setCardUsage('z', usage(0))
    expect(cardUsage('z')).toBeUndefined()
    setCardUsage('d', usage(10))
    const changes = vi.fn()
    const unsubscribe = subscribeUsage(changes)
    clearCardUsage('d')
    expect(cardUsage('d')).toBeUndefined()
    expect(changes).toHaveBeenCalledTimes(1)
    clearCardUsage('d')
    expect(changes).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
