import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Workspace } from '../../core/workspace-store'

// startCard and a card's pending worktree run (#69 D10).

const state = vi.hoisted(() => ({ workspaces: [] as Workspace[] }))
const started = vi.hoisted(() => [] as Card[])
const run = vi.hoisted(() => ({ kind: 'stopped' }))

const cleared = vi.hoisted(() => [] as string[])

vi.mock('./store', () => ({
  workspaceStore: {
    getState: () => state,
    clearClaudeStarted: (_w: string, cardId: string) => {
      cleared.push(cardId)
      state.workspaces = state.workspaces.map((w) => ({
        ...w,
        cards: w.cards.map((c) => (c.id === cardId ? { ...c, claudeStarted: false } : c))
      }))
    }
  }
}))
vi.mock('./card-terminals', () => ({
  cardTerminals: () => ({
    runState: () => run,
    start: (card: Card) => started.push(card)
  }),
  cardPanes: () => ({})
}))
vi.mock('./settings', () => ({ settingsStore: {} }))

const { startCard, startNewConversation } = await import('./card-actions')
const { pendingWorktreeRun } = await import('./pending-worktrees')
const { conversationCheck } = await import('./conversation-checks')

const card = (extra: Partial<Card>): Card =>
  ({ id: 'c1', title: 'Fix login', directory: '/repo', ...extra }) as Card

const show = (c: Card): void => {
  state.workspaces = [{ id: 'w1', cards: [c] } as unknown as Workspace]
}

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'
const prepare = vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'present')

beforeEach(() => {
  started.length = 0
  cleared.length = 0
  run.kind = 'stopped'
  prepare.mockReset()
  prepare.mockImplementation(async () => 'present')
  vi.stubGlobal('window', {
    bikube: {
      worktree: { create: vi.fn(async () => ({ ok: false, reason: 'fatal: branch exists' })) },
      transcripts: { prepare }
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

// Restore or ask before resume (#80 D11, D12).
describe('startCard of a Claude Code card that started Claude Code', () => {
  const claude = (extra: Partial<Card> = {}): Card =>
    card({
      startup: { kind: 'claude' },
      agentSessionId: SESSION,
      claudeStarted: true,
      startedAgents: [],
      ...extra
    })

  it('prepares the conversation first, then starts it when present or restored', async () => {
    for (const answer of ['present', 'restored']) {
      started.length = 0
      prepare.mockImplementation(async () => answer)
      show(claude())
      startCard('w1', 'c1')
      expect(started).toEqual([])
      expect(prepare).toHaveBeenLastCalledWith('c1', '/repo', SESSION)
      await vi.waitFor(() => expect(started).toHaveLength(1))
      expect(conversationCheck('c1')).toBeUndefined()
    }
  })

  it('starts as today when the check fails or is refused', async () => {
    for (const answer of [
      async () => 'refused',
      async () => {
        throw new Error('ipc')
      }
    ]) {
      started.length = 0
      prepare.mockImplementation(answer)
      show(claude())
      startCard('w1', 'c1')
      await vi.waitFor(() => expect(started).toHaveLength(1))
    }
  })

  it('starts nothing when it is missing, and Start a new conversation clears claudeStarted and starts', async () => {
    prepare.mockImplementation(async () => 'missing')
    show(claude())
    startCard('w1', 'c1')
    await vi.waitFor(() => expect(conversationCheck('c1')?.kind).toBe('gone'))
    expect(started).toEqual([])

    startNewConversation('w1', 'c1')
    expect(cleared).toEqual(['c1'])
    expect(started).toEqual([claude({ claudeStarted: false })])
    expect(conversationCheck('c1')).toBeUndefined()
  })

  it('checks nothing for a running card: opening it types no resume line', () => {
    run.kind = 'running'
    show(claude())
    startCard('w1', 'c1')
    expect(prepare).not.toHaveBeenCalled()
    expect(started).toEqual([claude()])
    expect(conversationCheck('c1')).toBeUndefined()
  })

  it('checks nothing for a card that never started Claude Code, SSH cards and presets (AC12)', () => {
    for (const other of [
      claude({ claudeStarted: false }),
      claude({ host: 'dev' }),
      claude({ startup: { kind: 'codex' } })
    ]) {
      started.length = 0
      show(other)
      startCard('w1', 'c1')
      expect(started).toEqual([other])
    }
    expect(prepare).not.toHaveBeenCalled()
  })
})
