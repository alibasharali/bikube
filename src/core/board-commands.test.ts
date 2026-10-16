import { describe, expect, it } from 'vitest'
import {
  NOT_IN_A_CARD,
  boardMoveTarget,
  cleanAgentStatus,
  findCallingWorkspace,
  notRunningError,
  resolveCard,
  resolveColumn,
  MAX_AGENT_STATUS_LENGTH
} from './board-commands'
import type { Card, Workspace, WorkspaceState } from './workspace-store'

const card = (id: string, columnId: string, title = id): Card => ({
  id,
  columnId,
  title,
  directory: '/tmp/drovr-alpha',
  startup: { kind: 'shell' },
  agentSessionId: 'x',
  claudeStarted: false,
  startedAgents: []
})

const workspace = (id: string, cards: Card[]): Workspace => ({
  id,
  name: id,
  directory: `/tmp/drovr-${id}`,
  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'running', name: 'Running' },
    { id: 'needs', name: 'Needs me' },
    { id: 'done', name: 'Done' }
  ],
  cards,
  nextCardNumber: 1,
  defaultStartup: { kind: 'claude' },
  shells: []
})

const alpha = workspace('alpha', [
  card('c-api', 'backlog', 'api'),
  card('c-web', 'backlog', 'web'),
  card('c-d1', 'done', 'dup'),
  card('c-d2', 'running', 'dup'),
  card('web', 'done', 'other web')
])
const beta = workspace('beta', [card('c-other', 'backlog', 'other')])
const state: WorkspaceState = { workspaces: [alpha, beta], activeId: 'beta' }

describe('findCallingWorkspace', () => {
  it('finds the workspace of the calling card, active or not', () => {
    expect(findCallingWorkspace(state, 'c-api')).toEqual({ ok: true, value: alpha })
    expect(findCallingWorkspace(state, 'c-other')).toEqual({ ok: true, value: beta })
  })

  it('refuses an unknown or empty card id', () => {
    for (const id of ['ghost', '']) {
      expect(findCallingWorkspace(state, id)).toEqual({ ok: false, error: NOT_IN_A_CARD })
    }
    expect(NOT_IN_A_CARD).toBe('board: not running inside a Drovr card')
  })
})

describe('resolveCard', () => {
  it('resolves . to the calling card', () => {
    expect(resolveCard(alpha, 'c-api', '.')).toEqual({ ok: true, value: alpha.cards[0] })
  })

  it('resolves an id, and an id wins over a title', () => {
    expect(resolveCard(alpha, 'c-api', 'c-web')).toEqual({ ok: true, value: alpha.cards[1] })
    expect(resolveCard(alpha, 'c-api', 'web')).toEqual({ ok: true, value: alpha.cards[4] })
  })

  it('resolves an exact, case-sensitive title', () => {
    expect(resolveCard(alpha, 'c-api', 'other web')).toEqual({ ok: true, value: alpha.cards[4] })
    expect(resolveCard(alpha, 'c-api', 'API')).toEqual({
      ok: false,
      error: 'board: no card "API" in this workspace'
    })
    expect(resolveCard(alpha, 'c-api', ' api')).toEqual({
      ok: false,
      error: 'board: no card " api" in this workspace'
    })
  })

  it('refuses a title shared by several cards, naming the count', () => {
    expect(resolveCard(alpha, 'c-api', 'dup')).toEqual({
      ok: false,
      error: 'board: 2 cards are titled "dup"; use the card id'
    })
  })

  it('refuses an unknown card and cards of other workspaces', () => {
    expect(resolveCard(alpha, 'c-api', 'ghost')).toEqual({
      ok: false,
      error: 'board: no card "ghost" in this workspace'
    })
    expect(resolveCard(alpha, 'c-api', 'other')).toEqual({
      ok: false,
      error: 'board: no card "other" in this workspace'
    })
    expect(resolveCard(alpha, 'c-api', 'c-other')).toEqual({
      ok: false,
      error: 'board: no card "c-other" in this workspace'
    })
  })
})

describe('resolveColumn', () => {
  it('matches a column title case-insensitively after trimming', () => {
    expect(resolveColumn(alpha, 'done')).toEqual({ ok: true, value: alpha.columns[3] })
    expect(resolveColumn(alpha, '  NEEDS ME ')).toEqual({ ok: true, value: alpha.columns[2] })
  })

  it('refuses an unknown column, listing the columns in board order', () => {
    expect(resolveColumn(alpha, 'Review')).toEqual({
      ok: false,
      error: 'board: no column "Review"; columns are: Backlog, Running, Needs me, Done'
    })
    const reordered = { ...alpha, columns: [alpha.columns[3], alpha.columns[0]] }
    expect(resolveColumn(reordered, 'needs')).toEqual({
      ok: false,
      error: 'board: no column "needs"; columns are: Done, Backlog'
    })
  })
})

describe('boardMoveTarget', () => {
  it('puts the card at the bottom of another column', () => {
    expect(boardMoveTarget(alpha, alpha.cards[0], 'done')).toEqual({ columnId: 'done', index: 2 })
    expect(boardMoveTarget(alpha, alpha.cards[0], 'needs')).toEqual({ columnId: 'needs', index: 0 })
  })

  it('changes nothing when the card is already in the column', () => {
    expect(boardMoveTarget(alpha, alpha.cards[0], 'backlog')).toBeNull()
  })
})

describe('cleanAgentStatus', () => {
  it('removes escape sequences and control characters', () => {
    expect(cleanAgentStatus('a\x1b[31mb')).toBe('ab')
    expect(cleanAgentStatus('x\x07y\x00z')).toBe('xyz')
  })

  it('collapses whitespace to single spaces and trims', () => {
    expect(cleanAgentStatus('  running \t\n  tests  ')).toBe('running tests')
  })

  it('cuts to 200 characters after cleaning', () => {
    expect(MAX_AGENT_STATUS_LENGTH).toBe(200)
    const long = 'abcdefghij'.repeat(30)
    expect(cleanAgentStatus(long)).toBe(long.slice(0, 200))
    expect(cleanAgentStatus(`\x1b[1m${'a'.repeat(200)}`)).toBe('a'.repeat(200))
  })

  it('is empty (clearing the status) for blank or escape-only text', () => {
    expect(cleanAgentStatus('')).toBe('')
    expect(cleanAgentStatus(' \t ')).toBe('')
    expect(cleanAgentStatus('\x1b[0m')).toBe('')
  })
})

describe('notRunningError', () => {
  it('names the card title', () => {
    expect(notRunningError(card('c-old', 'backlog', 'old'))).toBe('board: "old" is not running')
  })
})
