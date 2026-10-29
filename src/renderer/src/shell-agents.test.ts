import { describe, expect, it, vi } from 'vitest'
import type { ClaudeUsage } from '../../core/claude-usage-types'
import {
  clearShellAgent,
  setShellSession,
  setShellUsage,
  shellAgent,
  subscribeShellAgents
} from './shell-agents'

// A workspace shell's Claude Code session and usage, runtime only (#75 D3a).

const usage = (tokens: number): ClaudeUsage => ({
  input: tokens,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens,
  context: tokens,
  model: 'claude-opus-4-8'
})

const A = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'
const B = '1c7a2d2f-6e3b-4d2c-8b9f-4a2e3d5c6b70'

describe('shell agents', () => {
  it("keeps each shell's latest session and usage, and tells subscribers", () => {
    const changes = vi.fn()
    const unsubscribe = subscribeShellAgents(changes)
    expect(shellAgent('s1')).toBeUndefined()
    setShellSession('s1', A)
    setShellUsage('s1', usage(10))
    setShellSession('s1', B)
    setShellSession('s2', A)
    expect(shellAgent('s1')).toEqual({ sessionId: B, usage: usage(10) })
    expect(shellAgent('s2')).toEqual({ sessionId: A })
    expect(changes).toHaveBeenCalledTimes(4)
    // The same object until it changes, for useSyncExternalStore.
    expect(shellAgent('s1')).toBe(shellAgent('s1'))
    setShellSession('s1', B)
    expect(changes).toHaveBeenCalledTimes(4)
    unsubscribe()
    clearShellAgent('s1')
    clearShellAgent('s2')
  })

  it('forgets the usage on a zero report, and everything when cleared (its stop)', () => {
    setShellSession('s3', A)
    setShellUsage('s3', usage(10))
    setShellUsage('s3', usage(0))
    expect(shellAgent('s3')).toEqual({ sessionId: A })
    const changes = vi.fn()
    const unsubscribe = subscribeShellAgents(changes)
    clearShellAgent('s3')
    expect(shellAgent('s3')).toBeUndefined()
    clearShellAgent('s3')
    expect(changes).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
