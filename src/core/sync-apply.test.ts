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
    defaultStartup: { kind: 'claude' },
    shells: [],
    worktreeSetup: '',
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
    startedAgents: [],
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

describe("keeping this machine's startedAgents (#21 D7, AC9)", () => {
  it('keeps the local value for local cards this machine has, empty for new ones, the file’s for SSH', () => {
    const local = workspace('api', {
      cards: [
        card('known', 'api-backlog', { startedAgents: ['codex'] }),
        card('ssh', 'api-backlog', { host: 'devbox', startedAgents: [] })
      ]
    })
    const incoming = workspace('api', {
      cards: [
        card('known', 'api-backlog', { startedAgents: ['gemini'] }),
        card('fresh', 'api-backlog', { startedAgents: ['codex'] }),
        card('ssh', 'api-backlog', { host: 'devbox', startedAgents: ['opencode'] })
      ]
    })
    const [api] = applySyncBoard([incoming], [local], none)
    expect(api.cards.map((c) => [c.id, c.startedAgents])).toEqual([
      ['known', ['codex']],
      ['fresh', []],
      ['ssh', ['opencode']]
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

describe("keeping this machine's pending setups (#39 D8)", () => {
  it('keeps the local pending setup of a card this machine has, none for new ones', () => {
    const local = workspace('api', { cards: [card('known', 'api-backlog', { setup: 'npm ci' })] })
    const incoming = workspace('api', {
      cards: [card('known', 'api-backlog'), card('fresh', 'api-backlog')]
    })
    const [api] = applySyncBoard([incoming], [local], none)
    expect(api.cards.map((c) => [c.id, c.setup])).toEqual([
      ['known', 'npm ci'],
      ['fresh', undefined]
    ])
  })
})

describe('automatic move rules from the file (#42 D7, AC11)', () => {
  it("takes the file's rules for a workspace, and none when the file has none", () => {
    const local = [workspace('api', { autoMove: { stopped: 'api-backlog' } }), workspace('web')]
    const incoming = [workspace('api'), workspace('web', { autoMove: { waiting: 'web-running' } })]
    const applied = applySyncBoard(incoming, local, none)
    expect(applied[0]).not.toHaveProperty('autoMove')
    expect(applied[1]!.autoMove).toEqual({ waiting: 'web-running' })
  })
})

describe("keeping where this machine's shells run", () => {
  it('keeps the local runIn of each shell the file has, which never carries one', () => {
    const shell = {
      id: 's1',
      name: 'Dev',
      command: '',
      autostart: false,
      type: 'shell' as const
    }
    const local = [workspace('a', { shells: [{ ...shell, runIn: 'k1' }] })]
    const incoming = [
      workspace('a', {
        shells: [
          { ...shell, name: 'Dev server' },
          { ...shell, id: 's2' }
        ]
      })
    ]
    const [applied] = applySyncBoard(incoming, local, none)
    expect(applied!.shells).toEqual([
      { ...shell, name: 'Dev server', runIn: 'k1' },
      { ...shell, id: 's2' }
    ])
  })
})

describe("keeping this machine's temporary shells (#66 D2)", () => {
  it('keeps each workspace’s temporary shells after the file’s shells', () => {
    const shell = { id: 's1', name: 'Dev', command: '', autostart: false, type: 'shell' as const }
    const temp = { ...shell, id: 't1', name: 'Terminal 1', temporary: true as const }
    const local = [workspace('a', { shells: [shell, temp] }), workspace('b')]
    const incoming = [workspace('a', { shells: [{ ...shell, name: 'Dev server' }] })]
    const applied = applySyncBoard(incoming, local, none)
    expect(applied.map((w) => w.id)).toEqual(['a'])
    expect(applied[0]!.shells).toEqual([{ ...shell, name: 'Dev server' }, temp])
  })
})

describe('keeping when this machine last opened each card', () => {
  it('keeps the local open time of local and SSH cards it has; a new card has none', () => {
    const local = workspace('api', {
      cards: [
        card('known', 'api-backlog', { createdAt: 1, lastOpenedAt: 50 }),
        card('ssh', 'api-backlog', { host: 'devbox', lastOpenedAt: 60 })
      ]
    })
    const incoming = workspace('api', {
      cards: [
        card('known', 'api-backlog', { createdAt: 1 }),
        card('ssh', 'api-backlog', { host: 'devbox' }),
        card('fresh', 'api-backlog', { createdAt: 70 })
      ]
    })
    const [applied] = applySyncBoard([incoming], [local], none)
    expect(applied!.cards.map((c) => [c.id, c.createdAt, c.lastOpenedAt])).toEqual([
      ['known', 1, 50],
      ['ssh', undefined, 60],
      ['fresh', 70, undefined]
    ])
  })

  it("keeps this machine's last status and usage of the cards it has", () => {
    const usage = {
      input: 1,
      output: 2,
      cacheWrite: 3,
      cacheRead: 4,
      tokens: 10,
      context: 7,
      model: 'claude-opus-5-5'
    }
    const local = workspace('api', {
      cards: [card('known', 'api-backlog', { lastStatus: 'Tests green', lastUsage: usage })]
    })
    const incoming = workspace('api', { cards: [card('known', 'api-backlog')] })
    const [applied] = applySyncBoard([incoming], [local], none)
    expect(applied!.cards[0]).toMatchObject({ lastStatus: 'Tests green', lastUsage: usage })
  })
})
