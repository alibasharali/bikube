import { describe, expect, it } from 'vitest'
import { applySyncBoard } from './sync-apply'
import type { Card, Workspace } from './workspace-store'

function workspace(id: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name: id,
    directory: `/home/me/${id}`,
    columns: [
      { id: `${id}-backlog`, name: 'Backlog' },
      { id: `${id}-running`, name: 'Running' }
    ],
    cards: [],
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' },
    ...over
  }
}

function card(id: string, columnId: string, over: Partial<Card> = {}): Card {
  return {
    id,
    columnId,
    title: id,
    directory: '/home/me/api',
    startup: { kind: 'claude' },
    agentSessionId: `${id}-session`,
    claudeStarted: false,
    ...over
  }
}

const none = (): boolean => false

describe("keeping this machine's claudeStarted (#13 D6, AC6)", () => {
  it('keeps the local value for local cards this machine has, false for new ones, the file’s for SSH', () => {
    const local = workspace('api', {
      cards: [
        card('known', 'api-backlog', { claudeStarted: true }),
        card('ssh', 'api-backlog', { host: 'devbox', claudeStarted: false })
      ]
    })
    const incoming = workspace('api', {
      cards: [
        card('known', 'api-backlog', { claudeStarted: false }),
        card('fresh', 'api-backlog', { claudeStarted: false }),
        card('ssh', 'api-backlog', { host: 'devbox', claudeStarted: true })
      ]
    })
    const [api] = applySyncBoard([incoming], [local], none)
    expect(api.cards.map((c) => [c.id, c.claudeStarted])).toEqual([
      ['known', true],
      ['fresh', false],
      ['ssh', true]
    ])
  })
})

describe('keeping cards running here (#13 D8, AC4)', () => {
  const running =
    (...ids: string[]) =>
    (id: string): boolean =>
      ids.includes(id)

  it('keeps a running card the file deleted at the bottom of its column; stopped ones go', () => {
    const local = workspace('api', {
      cards: [card('one', 'api-backlog'), card('two', 'api-running'), card('three', 'api-running')]
    })
    const incoming = workspace('api', { cards: [card('three', 'api-running', { title: 'x' })] })
    const [api] = applySyncBoard([incoming], [local], running('two'))
    expect(api.cards.map((c) => [c.id, c.columnId, c.title])).toEqual([
      ['three', 'api-running', 'x'],
      ['two', 'api-running', 'two']
    ])
  })
})

describe('keeping cards running here when their column or workspace is gone (#13 D8)', () => {
  it("puts a running card whose column is gone at the bottom of the workspace's first column", () => {
    const local = workspace('api', { cards: [card('two', 'api-running')] })
    const incoming = workspace('api', {
      columns: [{ id: 'api-backlog', name: 'Backlog' }],
      cards: [card('one', 'api-backlog')]
    })
    const [api] = applySyncBoard([incoming], [local], (id) => id === 'two')
    expect(api.cards.map((c) => [c.id, c.columnId])).toEqual([
      ['one', 'api-backlog'],
      ['two', 'api-backlog']
    ])
  })

  it('keeps a deleted workspace whole, after the incoming ones, while one of its cards runs', () => {
    const api = workspace('api', {
      cards: [card('a', 'api-backlog', { claudeStarted: true }), card('b', 'api-backlog')]
    })
    const web = workspace('web')
    const gone = workspace('gone')
    const result = applySyncBoard([web], [api, gone, web], (id) => id === 'b')
    expect(result).toEqual([web, api])
  })

  it('takes a running card that the file has with its incoming values', () => {
    const local = workspace('api', { cards: [card('two', 'api-backlog', { title: 'old' })] })
    const incoming = workspace('api', { cards: [card('two', 'api-running', { title: 'new' })] })
    const [api] = applySyncBoard([incoming], [local], () => true)
    expect(api.cards).toEqual([card('two', 'api-running', { title: 'new' })])
  })
})
