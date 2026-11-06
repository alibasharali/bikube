import { describe, expect, it, vi } from 'vitest'
import { ClaudeCodeTerminals } from './claude-code-terminals'

describe('ClaudeCodeTerminals', () => {
  it('keeps which terminals run Claude Code, telling its listeners of each change only', () => {
    const terminals = new ClaudeCodeTerminals()
    const listener = vi.fn()
    terminals.subscribe(listener)
    expect(terminals.snapshot().has('a')).toBe(false)

    terminals.set('a', true)
    const first = terminals.snapshot()
    expect(first.has('a')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    terminals.set('a', true)
    terminals.set('b', false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(terminals.snapshot()).toBe(first)

    terminals.set('a', false)
    expect(terminals.snapshot().has('a')).toBe(false)
    expect(terminals.snapshot()).not.toBe(first)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('stops telling a listener once it unsubscribes', () => {
    const terminals = new ClaudeCodeTerminals()
    const listener = vi.fn()
    const unsubscribe = terminals.subscribe(listener)
    unsubscribe()
    terminals.set('a', true)
    expect(listener).not.toHaveBeenCalled()
  })
})
