import { describe, expect, it } from 'vitest'
import { defaultShellId, type Card, type Workspace } from './workspace-store'
import {
  nextWaiting,
  nextWaitingCard,
  waitingCounts,
  withActivity,
  withoutDeleted
} from './waiting'

function card(id: string): Card {
  return {
    id,
    columnId: 'backlog',
    title: id,
    directory: '/tmp',
    startup: { kind: 'shell' },
    agentSessionId: '',
    claudeStarted: false,
    startedAgents: []
  }
}

function workspace(id: string, cards: string[], shells: string[] = []): Workspace {
  return {
    id,
    name: id,
    directory: '/tmp',
    columns: [{ id: 'backlog', name: 'Backlog' }],
    cards: cards.map(card),
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' },
    shells: shells.map((s) => ({
      id: s,
      name: s,
      command: '',
      autostart: false,
      type: 'shell'
    })),
    worktreeSetup: ''
  }
}

const alpha = workspace('alpha', ['a1', 'a2'])
const beta = workspace('beta', ['b1', 'b2'], ['dev'])

describe('the next waiting card (#41 D4)', () => {
  it('cycles through the queue oldest first, skipping on from the open one', () => {
    const queue = ['a', 'b', 'c']
    expect(nextWaiting(queue, null)).toBe('a')
    expect(nextWaiting(queue, 'a')).toBe('b')
    expect(nextWaiting(queue, 'b')).toBe('c')
    expect(nextWaiting(queue, 'c')).toBe('a')
  })

  it('opens the oldest when the open card is not waiting', () => {
    expect(nextWaiting(['a', 'b'], 'other')).toBe('a')
  })

  it('opens nothing when only the open card waits, or none does', () => {
    expect(nextWaiting(['a'], 'a')).toBeNull()
    expect(nextWaiting([], null)).toBeNull()
    expect(nextWaiting([], 'a')).toBeNull()
  })
})

describe('the waiting queue (#41 D1, D2)', () => {
  it('adds a card as its activity becomes waiting or question, oldest first', () => {
    let queue: readonly string[] = []
    queue = withActivity(queue, 'one', 'waiting')
    queue = withActivity(queue, 'two', 'question')
    expect(queue).toEqual(['one', 'two'])
    expect(nextWaiting(queue, null)).toBe('one')
  })

  it('keeps the waiting since across a change between waiting and question', () => {
    let queue: readonly string[] = ['one', 'two']
    queue = withActivity(queue, 'one', 'question')
    expect(queue).toEqual(['one', 'two'])
    queue = withActivity(queue, 'one', 'waiting')
    expect(queue).toEqual(['one', 'two'])
  })

  it('drops a card whose activity becomes working or none, and it waits anew after', () => {
    let queue: readonly string[] = ['one', 'two']
    queue = withActivity(queue, 'one', 'working')
    expect(queue).toEqual(['two'])
    queue = withActivity(queue, 'one', 'waiting')
    expect(queue).toEqual(['two', 'one'])
    expect(nextWaiting(queue, null)).toBe('two')
    expect(withActivity(queue, 'two', null)).toEqual(['one'])
  })

  it('returns the same queue when nothing changes', () => {
    const queue = ['one']
    expect(withActivity(queue, 'one', 'question')).toBe(queue)
    expect(withActivity(queue, 'two', 'working')).toBe(queue)
    expect(withActivity(queue, 'two', null)).toBe(queue)
  })
})

describe('waiting per workspace (#41 D6)', () => {
  it('counts the waiting cards and shells, the Default shell included', () => {
    const queue = ['b1', defaultShellId('beta'), 'dev', 'a2']
    expect(waitingCounts(queue, [alpha, beta])).toEqual(
      new Map([
        ['beta', 3],
        ['alpha', 1]
      ])
    )
    expect(waitingCounts([], [alpha, beta])).toEqual(new Map())
  })

  it('drops deleted cards and shells, and keeps the Default shell of a workspace that exists', () => {
    const queue = ['b1', defaultShellId('beta'), 'dev', 'gone', defaultShellId('gone')]
    expect(withoutDeleted(queue, [alpha, beta])).toEqual(['b1', defaultShellId('beta'), 'dev'])
    expect(withoutDeleted(queue, [alpha, workspace('beta', ['b1'])])).toEqual([
      'b1',
      defaultShellId('beta')
    ])
  })

  it('returns the same queue when nothing was deleted', () => {
    const queue = ['b1', defaultShellId('beta')]
    expect(withoutDeleted(queue, [alpha, beta])).toBe(queue)
  })
})

describe('the next waiting card and its workspace (#41 D4, D5)', () => {
  it('names the workspace of the card or shell to open, the Default shell included', () => {
    const queue = ['b1', defaultShellId('beta'), 'a2']
    expect(nextWaitingCard(queue, null, [alpha, beta])).toEqual({
      workspaceId: 'beta',
      cardId: 'b1'
    })
    expect(nextWaitingCard(queue, 'b1', [alpha, beta])).toEqual({
      workspaceId: 'beta',
      cardId: defaultShellId('beta')
    })
    expect(nextWaitingCard(queue, 'a2', [alpha, beta])).toEqual({
      workspaceId: 'beta',
      cardId: 'b1'
    })
  })

  it('skips deleted cards and opens nothing when only the open one waits', () => {
    expect(nextWaitingCard(['gone', 'a1'], null, [alpha, beta])).toEqual({
      workspaceId: 'alpha',
      cardId: 'a1'
    })
    expect(nextWaitingCard(['gone', 'a1'], 'a1', [alpha, beta])).toBeNull()
    expect(nextWaitingCard([], null, [alpha, beta])).toBeNull()
  })
})

describe('a waiting Default shell (#41 AC7)', () => {
  it('counts 1 for its workspace and is the one the picker opens', () => {
    const queue = [defaultShellId('beta')]
    expect(waitingCounts(queue, [alpha, beta])).toEqual(new Map([['beta', 1]]))
    expect(nextWaitingCard(queue, null, [alpha, beta])).toEqual({
      workspaceId: 'beta',
      cardId: defaultShellId('beta')
    })
  })
})
