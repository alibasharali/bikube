import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Workspace } from '../../core/workspace-store'

// startCard and a card's pending worktree run (#69 D10).

const state = vi.hoisted(() => ({ workspaces: [] as Workspace[] }))
const started = vi.hoisted(() => [] as Card[])

vi.mock('./store', () => ({ workspaceStore: { getState: () => state } }))
vi.mock('./card-terminals', () => ({
  cardTerminals: () => ({
    runState: () => ({ kind: 'stopped' }),
    start: (card: Card) => started.push(card)
  }),
  cardPanes: () => ({})
}))
vi.mock('./settings', () => ({ settingsStore: {} }))

const { startCard } = await import('./card-actions')
const { pendingWorktreeRun } = await import('./pending-worktrees')

const card = (extra: Partial<Card>): Card =>
  ({ id: 'c1', title: 'Fix login', directory: '/repo', ...extra }) as Card

const show = (c: Card): void => {
  state.workspaces = [{ id: 'w1', cards: [c] } as unknown as Workspace]
}

beforeEach(() => {
  started.length = 0
  vi.stubGlobal('window', {
    bikube: {
      worktree: { create: vi.fn(async () => ({ ok: false, reason: 'fatal: branch exists' })) }
    }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('startCard', () => {
  it('forgets a failed pending worktree once the card has a worktree or no pending one', async () => {
    for (const later of [
      card({ worktree: { path: '/wt', branch: 'fix-login', repo: '/repo' } }),
      card({})
    ]) {
      show(card({ pendingWorktree: { branch: 'fix-login' } }))
      startCard('w1', 'c1')
      await vi.waitFor(() => expect(pendingWorktreeRun('c1')?.kind).toBe('failed'))
      expect(started).toEqual([])

      // Move to own worktree… (or sync) gave it a worktree, or its pending one was dropped.
      show(later)
      startCard('w1', 'c1')
      expect(started).toEqual([later])
      expect(pendingWorktreeRun('c1')).toBeUndefined()
      started.length = 0
    }
  })
})
