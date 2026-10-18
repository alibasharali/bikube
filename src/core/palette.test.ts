import { describe, expect, it } from 'vitest'
import {
  filterPalette,
  matchScore,
  paletteItems,
  type ActionRow,
  type OpenView,
  type PaletteInput,
  type PaletteItems,
  type RowStatus
} from './palette'
import { defaultKeymap } from './keymap'
import { defaultShellId, type Card, type Workspace, type WorkspaceState } from './workspace-store'

const COLUMNS = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' }
]

function card(id: string, title: string, columnId = 'backlog', extra: Partial<Card> = {}): Card {
  return {
    id,
    columnId,
    title,
    directory: '/tmp',
    startup: { kind: 'shell' },
    agentSessionId: '',
    claudeStarted: false,
    startedAgents: [],
    ...extra
  }
}

function workspace(
  id: string,
  name: string,
  cards: Card[],
  extra: Partial<Workspace> = {}
): Workspace {
  return {
    id,
    name,
    directory: '/tmp',
    columns: COLUMNS,
    cards,
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' },
    shells: [],
    ...extra
  }
}

const stopped = (): RowStatus => ({ label: 'Stopped' })

function input(state: WorkspaceState, extra: Partial<PaletteInput> = {}): PaletteInput {
  return {
    state,
    status: stopped,
    view: null,
    theme: 'system',
    keymap: defaultKeymap('linux'),
    platform: 'linux',
    ...extra
  }
}

describe('matchScore (#40 D4)', () => {
  it('matches each term as a case-insensitive subsequence, and nothing else', () => {
    expect(matchScore('flb', 'fix login bug Alpha', 'fix login bug')).not.toBeNull()
    expect(matchScore('flb', 'refactor billing Alpha', 'refactor billing')).toBeNull()
    expect(matchScore('alpha bill', 'refactor billing Alpha', 'refactor billing')).not.toBeNull()
    expect(matchScore('alpha bill', 'fix login bug Alpha', 'fix login bug')).toBeNull()
    expect(matchScore('qqq', 'fix login bug Alpha', 'fix login bug')).toBeNull()
    expect(matchScore('FLB', 'fix login bug', 'fix login bug')).not.toBeNull()
  })

  it('ranks a title prefix over a word start over contiguous over scattered', () => {
    const prefix = matchScore('dep', 'deploy api Beta', 'deploy api')!
    const wordStart = matchScore('dep', 'fix deps Beta', 'fix deps')!
    const contiguous = matchScore('dep', 'undeployed Beta', 'undeployed')!
    const scattered = matchScore('dep', 'do the pull Beta', 'do the pull')!
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(contiguous)
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('sums the terms, ignores extra spaces and matches everything with an empty query', () => {
    const one = matchScore('fix', 'fix login bug', 'fix login bug')!
    const two = matchScore('  fix   login ', 'fix login bug', 'fix login bug')!
    expect(two).toBeGreaterThan(one)
    expect(matchScore('', 'anything', 'anything')).toBe(0)
  })

  it('counts a word start after punctuation such as a branch name', () => {
    const wordStart = matchScore('search', 'x drovr/search-index', 'x')!
    const contiguous = matchScore('earch', 'x drovr/search-index', 'x')!
    expect(wordStart).toBeGreaterThan(contiguous)
  })
})

describe('paletteItems card and shell rows (#40 D3, D5)', () => {
  const alpha = workspace('a', 'Alpha', [
    card('two', 'two', 'progress'),
    card('one', 'one'),
    card('one-b', 'one b')
  ])
  const beta = workspace('b', 'Beta', [card('three', 'three')], {
    shells: [
      { id: 's1', name: 'Dev server', command: 'npm run dev', autostart: false },
      { id: 's2', name: 'Tests', command: '', autostart: false }
    ]
  })
  const gamma = workspace('g', 'Gamma', [card('four', 'four')])

  it('lists the active workspace first, then sidebar order, column by column, top to bottom', () => {
    const items = paletteItems(input({ workspaces: [gamma, alpha, beta], activeId: 'a' }))
    expect(items.cards.map((r) => r.title)).toEqual(['one', 'one b', 'two', 'four', 'three'])
    expect(items.cards[0]).toMatchObject({
      kind: 'card',
      workspaceId: 'a',
      cardId: 'one',
      workspaceName: 'Alpha',
      statusLabel: 'Stopped'
    })
  })

  it("lists each workspace's Default shell first, then its named shells in strip order", () => {
    const items = paletteItems(input({ workspaces: [alpha, beta], activeId: 'b' }))
    expect(items.shells.map((r) => [r.workspaceName, r.title, r.cardId])).toEqual([
      ['Beta', 'Default shell', defaultShellId('b')],
      ['Beta', 'Dev server', 's1'],
      ['Beta', 'Tests', 's2'],
      ['Alpha', 'Default shell', defaultShellId('a')]
    ])
    expect(items.shells.every((r) => r.kind === 'shell')).toBe(true)
  })

  it('shows a worktree branch, the live status label and the activity pill text', () => {
    const tree = card('wt', 'search', 'backlog', {
      worktree: { path: '/w', branch: 'drovr/search-index', repo: '/tmp' }
    })
    const state = {
      workspaces: [workspace('a', 'Alpha', [tree, card('r', 'agent')])],
      activeId: 'a'
    }
    const status = (id: string): RowStatus =>
      id === 'r' ? { label: 'Running', activity: 'question' } : { label: 'Stopped' }
    const [wt, running] = paletteItems(input(state, { status })).cards
    expect(wt).toMatchObject({ branch: 'drovr/search-index', statusLabel: 'Stopped' })
    expect(wt.activityText).toBeUndefined()
    expect(running).toMatchObject({ statusLabel: 'Running', activityText: 'Needs your answer' })
    expect(running.branch).toBeUndefined()
  })

  it('has no rows without workspaces', () => {
    const items = paletteItems(input({ workspaces: [], activeId: null }))
    expect(items.cards).toEqual([])
    expect(items.shells).toEqual([])
  })
})

describe('paletteItems actions (#40 D6)', () => {
  const alpha = workspace('a', 'Alpha', [card('c1', 'build')])
  const beta = workspace('b', 'Beta', [])
  const state: WorkspaceState = { workspaces: [alpha, beta], activeId: 'a' }
  const cardView: OpenView = {
    kind: 'card',
    workspaceId: 'a',
    cardId: 'c1',
    running: true,
    paneCount: 1,
    extraPaneFocused: false
  }
  const labels = (i: PaletteInput): string[] => paletteItems(i).actions.map((r) => r.label)
  const APP_ROWS = [
    'New card',
    'Open Default shell',
    'New workspace',
    'Open Settings',
    'Theme: Dark',
    'Theme: Light',
    'Switch to workspace Beta'
  ]

  it("offers a running card's view actions and moves to every other column", () => {
    expect(labels(input(state, { view: cardView }))).toEqual([
      'Back to board',
      'Split right',
      'Split down',
      'Close card',
      'Toggle panel',
      'Find',
      'Move card to In Progress',
      'Move card to Review',
      'Move card to Done',
      ...APP_ROWS
    ])
  })

  it('offers none of the view actions on the board', () => {
    expect(labels(input(state))).toEqual(APP_ROWS)
  })

  it('offers Close pane with an extra pane focused and no splits at 4 panes', () => {
    const view = { ...cardView, paneCount: 4, extraPaneFocused: true }
    expect(labels(input(state, { view })).slice(0, 4)).toEqual([
      'Back to board',
      'Close pane',
      'Close card',
      'Toggle panel'
    ])
  })

  it('offers no splits or Close card for a stopped card', () => {
    const view = { ...cardView, running: false }
    expect(labels(input(state, { view })).slice(0, 4)).toEqual([
      'Back to board',
      'Toggle panel',
      'Find',
      'Move card to In Progress'
    ])
  })

  it('offers no moves for a shell', () => {
    const view: OpenView = { ...cardView, kind: 'shell', cardId: defaultShellId('a') }
    expect(labels(input(state, { view })).slice(0, 7)).toEqual([
      'Back to board',
      'Split right',
      'Split down',
      'Close card',
      'Toggle panel',
      'Find',
      'New card'
    ])
  })

  it('offers only the app rows without workspaces, every theme but the current one', () => {
    expect(labels(input({ workspaces: [], activeId: null }, { theme: 'dark' }))).toEqual([
      'New workspace',
      'Open Settings',
      'Theme: System',
      'Theme: Light'
    ])
  })

  it('carries what each row does', () => {
    const rows = paletteItems(input(state, { view: cardView })).actions
    const byLabel = (l: string): ActionRow => rows.find((r) => r.label === l)!
    expect(byLabel('Move card to Review').action).toEqual({ id: 'moveCard', columnId: 'review' })
    expect(byLabel('Theme: Light').action).toEqual({ id: 'theme', theme: 'light' })
    expect(byLabel('Switch to workspace Beta').action).toEqual({
      id: 'switchWorkspace',
      workspaceId: 'b'
    })
    expect(byLabel('Back to board').action).toEqual({ id: 'back' })
  })

  it('shows shortcuts from the current keymap and Mod+digit for the first nine workspaces', () => {
    const many = Array.from({ length: 11 }, (_, i) => workspace(`w${i}`, `W${i + 1}`, []))
    const keymap = { ...defaultKeymap('darwin'), back: 'Ctrl+Alt+K' }
    const rows = paletteItems(
      input(
        { workspaces: [...many, alpha], activeId: 'a' },
        { view: { ...cardView, extraPaneFocused: true }, keymap, platform: 'darwin' }
      )
    ).actions
    const shortcut = (l: string): string | undefined => rows.find((r) => r.label === l)?.shortcut
    expect(shortcut('Back to board')).toBe('Ctrl+Alt+K')
    expect(shortcut('Split right')).toBe('Cmd+D')
    expect(shortcut('Split down')).toBe('Shift+Cmd+D')
    expect(shortcut('Close pane')).toBe('Cmd+W')
    expect(shortcut('Close card')).toBe('Shift+Cmd+W')
    expect(shortcut('Toggle panel')).toBe('Alt+Cmd+B')
    expect(shortcut('Find')).toBe('Cmd+F')
    expect(shortcut('Open Settings')).toBe('Cmd+,')
    expect(shortcut('Open Default shell')).toBe('Cmd+T')
    expect(shortcut('Move card to Review')).toBeUndefined()
    expect(shortcut('New card')).toBeUndefined()
    expect(shortcut('Theme: Dark')).toBeUndefined()
    expect(shortcut('Switch to workspace W1')).toBe('Cmd+1')
    expect(shortcut('Switch to workspace W9')).toBe('Cmd+9')
    expect(shortcut('Switch to workspace W10')).toBeUndefined()
    expect(rows.filter((r) => r.label.startsWith('Switch')).length).toBe(11)
  })

  it('shows Ctrl+<n> off macOS', () => {
    const rows = paletteItems(input(state)).actions
    expect(rows.find((r) => r.label === 'Switch to workspace Beta')?.shortcut).toBe('Ctrl+2')
  })
})

describe('filterPalette (#40 D4)', () => {
  const alpha = workspace('a', 'Alpha', [card('f', 'fix login bug'), card('r', 'refactor billing')])
  const beta = workspace('b', 'Beta', [card('bb', 'billing report')])
  const state: WorkspaceState = { workspaces: [alpha, beta], activeId: 'a' }
  const titles = (items: PaletteItems): string[] => items.cards.map((r) => r.title)

  it('keeps every row in order with an empty or blank query', () => {
    const items = paletteItems(input(state))
    expect(filterPalette(items, '')).toEqual(items)
    expect(filterPalette(items, '   ')).toEqual(items)
  })

  it('matches cards by title and workspace name, term by term', () => {
    const items = paletteItems(input(state))
    expect(titles(filterPalette(items, 'flb'))).toEqual(['fix login bug'])
    expect(titles(filterPalette(items, 'alpha bill'))).toEqual(['refactor billing'])
    const none = filterPalette(items, 'qqq')
    expect([...none.cards, ...none.shells, ...none.actions]).toEqual([])
  })

  it('matches a worktree branch and the activity text', () => {
    const tree = card('wt', 'index work', 'backlog', {
      worktree: { path: '/w', branch: 'drovr/search-index', repo: '/tmp' }
    })
    const s = { workspaces: [workspace('a', 'Alpha', [tree, card('q', 'agent')])], activeId: 'a' }
    const status = (id: string): RowStatus =>
      id === 'q' ? { label: 'Running', activity: 'question' } : { label: 'Stopped' }
    const items = paletteItems(input(s, { status }))
    expect(titles(filterPalette(items, 'search-index'))).toEqual(['index work'])
    // `needs` is scattered through the worktree card's text, a word start in the activity text.
    expect(filterPalette(items, 'needs').cards[0]).toMatchObject({
      title: 'agent',
      activityText: 'Needs your answer'
    })
    expect(titles(filterPalette(items, 'running'))).toEqual(['agent'])
  })

  it('matches actions by their label', () => {
    const items = paletteItems(input(state))
    expect(filterPalette(items, 'theme dark').actions.map((r) => r.label)).toEqual(['Theme: Dark'])
  })

  it('sorts each section by score, ties keeping the empty-query order', () => {
    const items = paletteItems(input(state))
    // 'billing report' starts with `bill`; 'refactor billing' only has it at a word start.
    expect(titles(filterPalette(items, 'bill'))).toEqual(['billing report', 'refactor billing'])
    // `i` is inside a word in every title: equal scores keep the order.
    expect(titles(filterPalette(items, 'i'))).toEqual([
      'fix login bug',
      'refactor billing',
      'billing report'
    ])
  })
})
