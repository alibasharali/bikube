import { describe, expect, it } from 'vitest'
import { gridSections, latestFirst, matchesSearch } from './card-grid'
import type { Card } from './workspace-store'

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    columnId: 'backlog',
    title: `Card ${id}`,
    directory: '/tmp/proj',
    startup: { kind: 'claude' },
    agentSessionId: `session-${id}`,
    claudeStarted: false,
    startedAgents: [],
    ...over
  }
}

const ids = (cards: Card[]): string[] => cards.map((c) => c.id)

describe('latestFirst', () => {
  it('puts the latest created or opened first, then cards without a time, the last on the board first', () => {
    const cards = [
      card('old'),
      card('a', { createdAt: 10 }),
      card('newer'),
      card('b', { createdAt: 5, lastOpenedAt: 30 }),
      card('c', { createdAt: 20, columnId: 'done' }),
      card('d', { lastOpenedAt: 15 })
    ]
    expect(ids(latestFirst(cards))).toEqual(['b', 'c', 'd', 'a', 'newer', 'old'])
  })

  it('keeps the later card first on a tie', () => {
    const cards = [card('a', { lastOpenedAt: 5 }), card('b', { lastOpenedAt: 5 })]
    expect(ids(latestFirst(cards))).toEqual(['b', 'a'])
  })
})

describe('matchesSearch', () => {
  const api = card('1', {
    title: 'Fix login API',
    startup: { kind: 'codex' },
    worktree: { path: '/tmp/w', branch: 'feat/auth-flow', repo: '/tmp/proj' }
  })

  it('matches every term anywhere in the title, branch or agent, any case', () => {
    expect(matchesSearch(api, '')).toBe(true)
    expect(matchesSearch(api, '  login   api ')).toBe(true)
    expect(matchesSearch(api, 'AUTH')).toBe(true)
    expect(matchesSearch(api, 'codex fix')).toBe(true)
    expect(matchesSearch(api, 'login billing')).toBe(false)
    expect(matchesSearch(card('2', { title: 'x', startup: { kind: 'claude' } }), 'claude')).toBe(
      true
    )
    expect(
      matchesSearch(card('3', { startup: { kind: 'custom', command: 'npm run dev' } }), 'npm')
    ).toBe(true)
  })
})

describe('gridSections', () => {
  const cards = [
    card('stopped', { lastOpenedAt: 1 }),
    card('waits', { lastOpenedAt: 2 }),
    card('runs', { lastOpenedAt: 3 }),
    card('runs-too', { lastOpenedAt: 4, title: 'deploy' })
  ]
  const state = {
    isRunning: (id: string) => id !== 'stopped',
    isWaiting: (id: string) => id === 'waits' || id === 'stopped'
  }

  it('splits the cards into waiting, running and stopped, each latest first', () => {
    const sections = gridSections(cards, state, '', 'all')
    expect(ids(sections.waiting)).toEqual(['waits'])
    expect(ids(sections.running)).toEqual(['runs-too', 'runs'])
    expect(ids(sections.stopped)).toEqual(['stopped'])
  })

  it("shows only the filter's section", () => {
    const sections = gridSections(cards, state, '', 'running')
    expect(ids(sections.waiting)).toEqual([])
    expect(ids(sections.running)).toEqual(['runs-too', 'runs'])
    expect(ids(sections.stopped)).toEqual([])
  })

  it('keeps only the cards matching the search', () => {
    const sections = gridSections(cards, state, 'deploy', 'all')
    expect(ids([...sections.waiting, ...sections.running, ...sections.stopped])).toEqual([
      'runs-too'
    ])
  })
})
