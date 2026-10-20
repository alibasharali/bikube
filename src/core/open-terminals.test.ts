import { describe, expect, it } from 'vitest'
import type { Activity } from './activity'
import { openTerminals } from './open-terminals'
import { defaultShellId, type Card, type Workspace } from './workspace-store'

const COLUMNS = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'progress', name: 'In Progress' }
]

function card(id: string, title: string, columnId = 'backlog'): Card {
  return {
    id,
    columnId,
    title,
    directory: '/tmp',
    startup: { kind: 'shell' },
    agentSessionId: '',
    claudeStarted: false,
    startedAgents: []
  }
}

function workspace(id: string, cards: Card[], shells: Workspace['shells'] = []): Workspace {
  return {
    id,
    name: id.toUpperCase(),
    directory: '/tmp',
    columns: COLUMNS,
    cards,
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' },
    shells,
    worktreeSetup: ''
  }
}

const running =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id)
const noActivity = (): Activity | undefined => undefined

describe('openTerminals', () => {
  it('lists only running cards and shells, by workspace, cards in column order, then shells', () => {
    const a = workspace(
      'a',
      [card('a2', 'Second', 'progress'), card('a1', 'First'), card('a3', 'Stopped one')],
      [{ id: 'dev', name: 'Dev server', command: 'npm run dev', autostart: false }]
    )
    const b = workspace('b', [card('b1', 'Other')])
    const rows = openTerminals(
      [a, b],
      running('a1', 'a2', 'dev', defaultShellId('a'), 'b1'),
      noActivity
    )
    expect(rows.map((r) => [r.kind, r.workspaceId, r.title])).toEqual([
      ['card', 'a', 'First'],
      ['card', 'a', 'Second'],
      ['shell', 'a', 'Default shell'],
      ['shell', 'a', 'Dev server'],
      ['card', 'b', 'Other']
    ])
  })

  it('gives each row its activity when one is set', () => {
    const a = workspace('a', [card('a1', 'One'), card('a2', 'Two')])
    const rows = openTerminals([a], running('a1', 'a2'), (id) =>
      id === 'a2' ? 'question' : undefined
    )
    expect(rows).toEqual([
      { kind: 'card', workspaceId: 'a', cardId: 'a1', title: 'One' },
      { kind: 'card', workspaceId: 'a', cardId: 'a2', title: 'Two', activity: 'question' }
    ])
  })

  it('is empty when nothing runs', () => {
    expect(openTerminals([workspace('a', [card('a1', 'One')])], running(), noActivity)).toEqual([])
  })
})
