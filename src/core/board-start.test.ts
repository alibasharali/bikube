import { describe, expect, it } from 'vitest'
import { CONVERSATION_GONE_REASON, startOutcome } from './board-start'

describe("a `board start`'s outcome (#81 D17)", () => {
  it('waits while its worktree is made or its conversation checked', () => {
    expect(startOutcome({ pendingWorktree: { kind: 'making' }, spawned: false })).toBeNull()
    expect(startOutcome({ conversation: { kind: 'checking' }, spawned: false })).toBeNull()
    expect(startOutcome({ spawned: false })).toBeNull()
    expect(startOutcome({ runState: { kind: 'running' }, spawned: false })).toBeNull()
  })

  it('succeeds once its shell is spawned, or once it ran and stopped', () => {
    expect(startOutcome({ runState: { kind: 'running' }, spawned: true })).toEqual({ ok: true })
    expect(startOutcome({ runState: { kind: 'stopped' }, spawned: false })).toEqual({ ok: true })
  })

  it('fails with the reason its worktree, conversation or spawn gave', () => {
    expect(
      startOutcome({ pendingWorktree: { kind: 'failed', reason: 'branch exists' }, spawned: false })
    ).toEqual({ ok: false, reason: 'branch exists' })
    expect(startOutcome({ conversation: { kind: 'gone' }, spawned: false })).toEqual({
      ok: false,
      reason: CONVERSATION_GONE_REASON
    })
    expect(
      startOutcome({
        runState: { kind: 'failed', reason: 'working directory not found' },
        spawned: false
      })
    ).toEqual({ ok: false, reason: 'working directory not found' })
  })
})
