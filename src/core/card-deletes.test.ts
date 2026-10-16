import { describe, expect, it } from 'vitest'
import {
  cardCloseConfirmation,
  cardDeleteConfirmation,
  columnDeleteHint,
  runningCount,
  workspaceDeleteMessage
} from './card-deletes'
import type { CardRunState } from './card-status'
import { InMemoryWorkspaceStore, type Result, type Workspace } from './workspace-store'

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.field}: ${r.error.message}`)
  return r.value
}

function alpha(): { s: InMemoryWorkspaceStore; ws: () => Workspace } {
  const s = new InMemoryWorkspaceStore()
  const id = ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/drovr-alpha' })).id
  return { s, ws: () => s.getState().workspaces.find((w) => w.id === id)! }
}

describe('column delete hint (AC11, D14)', () => {
  it('blocks a column with cards with "Move or delete its cards first", and clears once they are gone', () => {
    const { s, ws } = alpha()
    const backlog = ws().columns[0].id
    expect(columnDeleteHint(ws(), backlog)).toEqual({ canDelete: true, hint: null })
    const api = ok(s.createCard(ws().id, backlog, 'api'))
    expect(columnDeleteHint(ws(), backlog)).toEqual({
      canDelete: false,
      hint: 'Move or delete its cards first'
    })
    expect(columnDeleteHint(ws(), ws().columns[1].id)).toEqual({ canDelete: true, hint: null })
    ok(s.deleteCard(ws().id, api.id))
    expect(columnDeleteHint(ws(), backlog)).toEqual({ canDelete: true, hint: null })
  })

  it('keeps the last column undeletable without a hint, even when it has cards', () => {
    const { s, ws } = alpha()
    const [first, ...rest] = ws().columns
    rest.forEach((c) => ok(s.deleteColumn(ws().id, c.id)))
    expect(columnDeleteHint(ws(), first.id)).toEqual({ canDelete: false, hint: null })
    ok(s.createCard(ws().id, first.id, 'api'))
    expect(columnDeleteHint(ws(), first.id)).toEqual({ canDelete: false, hint: null })
  })

  it('clears once the cards are moved to another column (#6 AC10)', () => {
    const { s, ws } = alpha()
    const [backlog, running] = ws().columns
    const api = ok(s.createCard(ws().id, backlog.id, 'api'))
    ok(s.moveCard(ws().id, api.id, running.id, 0))
    expect(columnDeleteHint(ws(), backlog.id)).toEqual({ canDelete: true, hint: null })
    expect(columnDeleteHint(ws(), running.id)).toEqual({
      canDelete: false,
      hint: 'Move or delete its cards first'
    })
  })
})

describe('card delete confirmation (AC10, D13)', () => {
  it('asks only while the process runs', () => {
    expect(cardDeleteConfirmation('api', { kind: 'running' })).toBe(
      'Delete "api"? Its terminal is still running and will be stopped.'
    )
    expect(cardDeleteConfirmation('old', { kind: 'stopped' })).toBeNull()
    expect(cardDeleteConfirmation('x', { kind: 'failed', reason: 'nope' })).toBeNull()
    expect(cardDeleteConfirmation('gone', undefined)).toBeNull()
  })
})

describe('card close confirmation (#7 D4)', () => {
  it('names the card and says how to start it again', () => {
    expect(cardCloseConfirmation('api')).toBe(
      'Close "api"? Its terminal will be stopped. Open the card again to start it with its startup command.'
    )
  })
})

describe('workspace delete message (AC12, D15)', () => {
  const states: Record<string, CardRunState> = {
    a: { kind: 'running' },
    b: { kind: 'running' },
    c: { kind: 'stopped' },
    d: { kind: 'failed', reason: 'nope' }
  }

  it('counts the running cards of a workspace', () => {
    const cards = ['a', 'b', 'c', 'd', 'unknown'].map((id) => ({ id }))
    expect(runningCount(cards, (id) => states[id])).toBe(2)
    expect(runningCount([], (id) => states[id])).toBe(0)
  })

  it('is unchanged without running cards and adds the count otherwise', () => {
    expect(workspaceDeleteMessage('alpha', 0)).toBe('Delete "alpha"? This removes its board.')
    expect(workspaceDeleteMessage('alpha', 1)).toBe(
      'Delete "alpha"? This removes its board. 1 terminal is still running and will be stopped.'
    )
    expect(workspaceDeleteMessage('alpha', 2)).toBe(
      'Delete "alpha"? This removes its board. 2 terminals are still running and will be stopped.'
    )
  })
})

describe('workspaceDeleteMessage with worktree cards', () => {
  it('says the worktrees are kept', () => {
    expect(workspaceDeleteMessage('api', 0, 1)).toBe(
      'Delete "api"? This removes its board. Its card\'s worktree is kept.'
    )
    expect(workspaceDeleteMessage('api', 2, 3)).toBe(
      'Delete "api"? This removes its board. 2 terminals are still running and will be stopped. ' +
        "Its cards' 3 worktrees are kept."
    )
  })
})
