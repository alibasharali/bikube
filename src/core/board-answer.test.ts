import { describe, expect, it } from 'vitest'
import { answerBoardCommand } from './board-answer'
import { NOT_IN_A_CARD } from './board-commands'
import type { ClaudeUsage } from './claude-usage-types'
import {
  InMemoryWorkspaceStore,
  type Card,
  type Workspace,
  type WorkspaceState
} from './workspace-store'

const card = (id: string, columnId: string, title = id): Card => ({
  id,
  columnId,
  title,
  directory: '/tmp/bikube-alpha',
  startup: { kind: 'shell' },
  agentSessionId: 'x',
  claudeStarted: false,
  startedAgents: []
})

const workspace = (id: string, cards: Card[]): Workspace => ({
  id,
  name: id,
  directory: `/tmp/bikube-${id}`,
  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'running', name: 'Running' },
    { id: 'needs', name: 'Needs me' },
    { id: 'done', name: 'Done' }
  ],
  cards,
  nextCardNumber: 1,
  defaultStartup: { kind: 'claude' },
  shells: [],
  worktreeSetup: ''
})

function setup(): InMemoryWorkspaceStore {
  const state: WorkspaceState = {
    workspaces: [
      workspace('alpha', [
        card('c-api', 'backlog', 'api'),
        card('c-web', 'backlog', 'web'),
        card('c-done', 'done', 'shipped'),
        card('c-old', 'backlog', 'old')
      ]),
      workspace('beta', [card('c-other', 'backlog', 'other')])
    ],
    activeId: 'beta'
  }
  return new InMemoryWorkspaceStore({ initialState: state })
}

const running = (id: string): boolean => id !== 'c-old'
const columnOf = (store: InMemoryWorkspaceStore, id: string): string | undefined =>
  store
    .getState()
    .workspaces.flatMap((w) => w.cards)
    .find((c) => c.id === id)?.columnId
const alphaCards = (store: InMemoryWorkspaceStore): string[] =>
  store.getState().workspaces[0].cards.map((c) => c.id)

describe('answerBoardCommand', () => {
  it('moves the calling card to the bottom of the named column (#9 D7, AC1)', () => {
    const store = setup()
    const reply = answerBoardCommand(
      store,
      'c-api',
      { command: 'move', card: '.', column: ' done ' },
      running,
      () => {}
    )
    expect(reply).toEqual({ ok: true })
    expect(columnOf(store, 'c-api')).toBe('done')
    expect(alphaCards(store).filter((id) => columnOf(store, id) === 'done')).toEqual([
      'c-done',
      'c-api'
    ])
  })

  it('moves a sibling by title or id, in an inactive workspace too (#9 D2, AC2)', () => {
    const store = setup()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'web', column: 'Needs me' },
        running,
        () => {}
      )
    ).toEqual({ ok: true })
    expect(columnOf(store, 'c-web')).toBe('needs')
    expect(columnOf(store, 'c-api')).toBe('backlog')
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'c-web', column: 'Running' },
        running,
        () => {}
      )
    ).toEqual({ ok: true })
    expect(columnOf(store, 'c-web')).toBe('running')
  })

  it('changes nothing for a move to the column the card is in', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'web', column: 'Backlog' },
        running,
        () => {}
      )
    ).toEqual({ ok: true })
    expect(store.getState()).toBe(before)
  })

  it('answers the resolution errors and moves nothing (#9 AC3, AC4)', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: '.', column: 'Review' },
        running,
        () => {}
      )
    ).toEqual({
      ok: false,
      error: 'board: no column "Review"; columns are: Backlog, Running, Needs me, Done'
    })
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'other', column: 'Done' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: 'board: no card "other" in this workspace' })
    expect(store.getState()).toBe(before)
  })

  it('refuses a calling card the board does not have (#9 D3)', () => {
    const store = setup()
    expect(
      answerBoardCommand(
        store,
        'ghost',
        { command: 'move', card: '.', column: 'Done' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: NOT_IN_A_CARD })
  })

  it('accepts status for a running card and refuses it for one that is not (#9 D8)', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'status', card: '.', text: 'hi' },
        running,
        () => {}
      )
    ).toEqual({ ok: true })
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'status', card: 'old', text: 'hi' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: 'board: "old" is not running' })
    // Kept as the card's last status, shown once it stops; a refused one changes nothing.
    const cards = store.getState().workspaces.flatMap((w) => w.cards)
    expect(cards.find((c) => c.id === 'c-api')?.lastStatus).toBe('hi')
    expect(cards.filter((c) => c.lastStatus !== undefined)).toHaveLength(1)
    expect(store.getState()).not.toBe(before)
  })
  it("sets the card's agent status to the cleaned text (#9 D8, AC5)", () => {
    const store = setup()
    const set: [string, string][] = []
    const setAgentStatus = (id: string, text: string): void => {
      set.push([id, text])
    }
    const status = (card: string, text: string): unknown =>
      answerBoardCommand(store, 'c-api', { command: 'status', card, text }, running, setAgentStatus)
    expect(status('.', '  running \n tests ')).toEqual({ ok: true })
    expect(status('web', 'a\x1b[31mb')).toEqual({ ok: true })
    expect(status('.', 'x'.repeat(300))).toEqual({ ok: true })
    expect(status('.', '')).toEqual({ ok: true })
    expect(status('old', 'hi')).toEqual({ ok: false, error: 'board: "old" is not running' })
    expect(set).toEqual([
      ['c-api', 'running tests'],
      ['c-web', 'ab'],
      ['c-api', 'x'.repeat(200)],
      ['c-api', '']
    ])
  })

  it('sets the session the card resumes, and marks it started', () => {
    const store = setup()
    const reply = answerBoardCommand(
      store,
      'c-api',
      { command: 'session', card: '.', session: '6F1C1B1E-2F0E-4A59-9A43-0D6C4B0F1A11' },
      running,
      () => {}
    )
    expect(reply).toEqual({ ok: true })
    const card = store.getState().workspaces[0]!.cards.find((c) => c.id === 'c-api')!
    expect(card).toMatchObject({
      agentSessionId: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11',
      claudeStarted: true
    })
  })

  it("sets and clears the card's activity, only on a running card (#31 D12)", () => {
    const store = setup()
    const before = store.getState()
    const set: [string, string | null][] = []
    const activity = (card: string, value: 'working' | 'waiting' | 'question' | 'none'): unknown =>
      answerBoardCommand(
        store,
        'c-api',
        { command: 'activity', card, activity: value },
        running,
        () => {},
        (id, next) => {
          set.push([id, next])
        }
      )
    expect(activity('.', 'working')).toEqual({ ok: true })
    expect(activity('web', 'waiting')).toEqual({ ok: true })
    expect(activity('.', 'question')).toEqual({ ok: true })
    expect(activity('.', 'none')).toEqual({ ok: true })
    expect(activity('old', 'working')).toEqual({ ok: false, error: 'board: "old" is not running' })
    expect(activity('other', 'working')).toEqual({
      ok: false,
      error: 'board: no card "other" in this workspace'
    })
    expect(set).toEqual([
      ['c-api', 'working'],
      ['c-web', 'waiting'],
      ['c-api', 'question'],
      ['c-api', null]
    ])
    expect(store.getState()).toBe(before)
  })

  it("hands the card's usage on, only for a running card, and keeps it as the card's last", () => {
    const store = setup()
    const before = store.getState()
    const set: [string, ClaudeUsage][] = []
    const usage: ClaudeUsage = {
      input: 1,
      output: 2,
      cacheWrite: 0,
      cacheRead: 0,
      tokens: 3,
      context: 1,
      model: null
    }
    const report = (card: string): unknown =>
      answerBoardCommand(
        store,
        'c-api',
        { command: 'usage', card, usage },
        running,
        () => {},
        () => {},
        () => {},
        (id, next) => {
          set.push([id, next])
        }
      )
    expect(report('.')).toEqual({ ok: true })
    expect(report('web')).toEqual({ ok: true })
    expect(report('old')).toEqual({ ok: false, error: 'board: "old" is not running' })
    expect(report('other')).toEqual({
      ok: false,
      error: 'board: no card "other" in this workspace'
    })
    expect(set).toEqual([
      ['c-api', usage],
      ['c-web', usage]
    ])
    const cards = store.getState().workspaces.flatMap((w) => w.cards)
    expect(cards.filter((c) => c.lastUsage).map((c) => c.id)).toEqual(['c-api', 'c-web'])
    expect(store.getState()).not.toBe(before)
  })

  describe('setup (#39 D4)', () => {
    /** The store with c-api pending `npm ci`. */
    function pending(): InMemoryWorkspaceStore {
      const store = setup()
      const state = store.getState()
      const [alpha, beta] = state.workspaces
      return new InMemoryWorkspaceStore({
        initialState: {
          ...state,
          workspaces: [
            {
              ...alpha,
              cards: alpha.cards.map((c) => (c.id === 'c-api' ? { ...c, setup: 'npm ci' } : c))
            },
            beta
          ]
        }
      })
    }
    const apiCard = (store: InMemoryWorkspaceStore): Card | undefined =>
      store.getState().workspaces[0].cards.find((c) => c.id === 'c-api')

    it('on ok clears the pending setup, then hands the cleared card on to start', () => {
      const store = pending()
      const seen: [Card, string][] = []
      const reply = answerBoardCommand(
        store,
        'c-api',
        { command: 'setup', card: 'api', result: 'ok' },
        running,
        () => {},
        () => {},
        (c, result) => seen.push([c, result])
      )
      expect(reply).toEqual({ ok: true })
      expect(apiCard(store)?.setup).toBeUndefined()
      expect(seen).toEqual([[apiCard(store), 'ok']])
    })

    it('on failed keeps the pending setup and hands it on', () => {
      const store = pending()
      const seen: string[] = []
      const reply = answerBoardCommand(
        store,
        'c-api',
        { command: 'setup', card: '.', result: 'failed' },
        running,
        () => {},
        () => {},
        (c, result) => seen.push(`${c.id} ${result}`)
      )
      expect(reply).toEqual({ ok: true })
      expect(apiCard(store)?.setup).toBe('npm ci')
      expect(seen).toEqual(['c-api failed'])
    })

    it('refuses a card with no pending setup, or one not running, changing nothing (AC11)', () => {
      const store = pending()
      const seen: string[] = []
      const answer = (cardId: string, isRunning: (id: string) => boolean): unknown =>
        answerBoardCommand(
          store,
          cardId,
          { command: 'setup', card: '.', result: 'ok' },
          isRunning,
          () => {},
          () => {},
          (c) => seen.push(c.id)
        )
      expect(answer('c-web', running)).toEqual({
        ok: false,
        error: 'board: web has no setup running'
      })
      expect(answer('c-api', () => false)).toEqual({
        ok: false,
        error: 'board: api has no setup running'
      })
      expect(apiCard(store)?.setup).toBe('npm ci')
      expect(seen).toEqual([])
    })

    it("refuses another card's setup, even one pending, changing nothing (D4, AC11)", () => {
      const store = pending()
      const before = store.getState()
      const seen: string[] = []
      for (const result of ['ok', 'failed'] as const) {
        const reply = answerBoardCommand(
          store,
          'c-web',
          { command: 'setup', card: 'api', result },
          running,
          () => {},
          () => {},
          (c) => seen.push(c.id)
        )
        expect(reply).toEqual({ ok: false, error: 'board: api has no setup running' })
      }
      expect(store.getState()).toBe(before)
      expect(seen).toEqual([])
    })
  })
})

describe('answerBoardCommand: list, create and rename', () => {
  const runtime = (id: string): { running: boolean; activity?: 'working'; status?: string } =>
    id === 'c-api'
      ? { running: true, activity: 'working', status: 'running tests' }
      : { running: running(id) }

  it("lists the calling card's workspace as JSON, columns in order with their cards", () => {
    const store = setup()
    const reply = answerBoardCommand(
      store,
      'c-web',
      { command: 'list', format: 'json' },
      running,
      () => {},
      undefined,
      undefined,
      undefined,
      runtime
    )
    if (!reply.ok || reply.output === undefined) throw new Error('no output')
    const listing = JSON.parse(reply.output)
    expect(listing.workspace).toEqual({
      id: 'alpha',
      name: 'alpha',
      directory: '/tmp/bikube-alpha'
    })
    expect(listing.columns.map((c: { name: string }) => c.name)).toEqual([
      'Backlog',
      'Running',
      'Needs me',
      'Done'
    ])
    expect(listing.columns[0].cards).toEqual([
      { id: 'c-api', title: 'api', state: 'running', activity: 'working', status: 'running tests' },
      { id: 'c-web', title: 'web', state: 'running', self: true },
      { id: 'c-old', title: 'old', state: 'stopped' }
    ])
    expect(listing.columns[1].cards).toEqual([])
  })

  it('lists as lines for a person', () => {
    const reply = answerBoardCommand(
      setup(),
      'c-web',
      { command: 'list', format: 'text' },
      running,
      () => {},
      undefined,
      undefined,
      undefined,
      runtime
    )
    expect(reply).toEqual({
      ok: true,
      output: [
        'alpha (/tmp/bikube-alpha)',
        '',
        'Backlog (3)',
        '  api  [c-api]  running, working',
        '    status: running tests',
        '  web  [c-web]  running, this card',
        '  old  [c-old]  stopped',
        '',
        'Running (0)',
        '',
        'Needs me (0)',
        '',
        'Done (1)',
        '  shipped  [c-done]  running',
        ''
      ].join('\n')
    })
  })

  it('creates a card at the bottom of the column, not started, and answers with its id and workspace', () => {
    const store = setup()
    const reply = answerBoardCommand(
      store,
      'c-api',
      { command: 'create', column: 'needs me', title: '  Fix login\n bug (NOT-12) ' },
      running,
      () => {}
    )
    const created = store.getState().workspaces[0].cards.at(-1)
    expect(created).toMatchObject({
      columnId: 'needs',
      title: 'Fix login bug (NOT-12)',
      startup: { kind: 'claude' }
    })
    // `<id> <workspace name>` (#69 D8).
    expect(reply).toEqual({ ok: true, output: `${created?.id} alpha\n` })
  })

  it('refuses a create with no title or an unknown column, changing nothing', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'create', column: 'Done', title: ' ' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: 'board: a title is required' })
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'create', column: 'Later', title: 'x' },
        running,
        () => {}
      )
    ).toEqual({
      ok: false,
      error: 'board: no column "Later"; columns are: Backlog, Running, Needs me, Done'
    })
    expect(store.getState()).toBe(before)
  })

  it('renames a card by title or id; an empty title is refused', () => {
    const store = setup()
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'rename', card: 'web', title: 'web app' },
        running,
        () => {}
      )
    ).toEqual({ ok: true })
    expect(store.getState().workspaces[0].cards[1].title).toBe('web app')
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'rename', card: '.', title: '' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: 'board: a title is required' })
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'rename', card: 'other', title: 'x' },
        running,
        () => {}
      )
    ).toEqual({ ok: false, error: 'board: no card "other" in this workspace' })
  })

  it('needs a calling card on the board', () => {
    expect(
      answerBoardCommand(setup(), 'c-gone', { command: 'list', format: 'text' }, running, () => {})
    ).toEqual({ ok: false, error: NOT_IN_A_CARD })
  })
})

describe('answerBoardCommand: description and describe (#69 D5)', () => {
  const descriptionOf = (store: InMemoryWorkspaceStore, id: string): string | undefined =>
    store
      .getState()
      .workspaces.flatMap((w) => w.cards)
      .find((c) => c.id === id)?.description
  const answer = (
    store: InMemoryWorkspaceStore,
    command: Parameters<typeof answerBoardCommand>[2]
  ): ReturnType<typeof answerBoardCommand> =>
    answerBoardCommand(store, 'c-api', command, running, () => {})

  it("prints the card's description and one newline, or nothing when it has none (AC4)", () => {
    const store = setup()
    expect(answer(store, { command: 'description', card: '.' })).toEqual({ ok: true })
    store.setCardDescription('alpha', 'c-web', 'Hello 69')
    expect(answer(store, { command: 'description', card: 'web' })).toEqual({
      ok: true,
      output: 'Hello 69\n'
    })
  })

  it('replaces it, stopped or running, trimmed; empty removes it (AC4)', () => {
    const store = setup()
    expect(answer(store, { command: 'describe', card: '.', description: 'New text\n\n' })).toEqual({
      ok: true
    })
    expect(descriptionOf(store, 'c-api')).toBe('New text')
    expect(answer(store, { command: 'describe', card: 'old', description: 'x' })).toEqual({
      ok: true
    })
    expect(descriptionOf(store, 'c-old')).toBe('x')
    expect(answer(store, { command: 'describe', card: '.', description: '' })).toEqual({ ok: true })
    expect(descriptionOf(store, 'c-api')).toBeUndefined()
  })

  it('refuses one over 100,000 characters, changing nothing (AC4)', () => {
    const store = setup()
    store.setCardDescription('alpha', 'c-api', 'Hello 69')
    expect(
      answer(store, { command: 'describe', card: '.', description: 'a'.repeat(100_001) })
    ).toEqual({ ok: false, error: 'board: Description is longer than 100,000 characters' })
    expect(descriptionOf(store, 'c-api')).toBe('Hello 69')
  })

  it('keeps a 100,000-character multi-byte description whole (AC14)', () => {
    const store = setup()
    const text = '🎉é'.repeat(50_000)
    expect(answer(store, { command: 'describe', card: '.', description: text })).toEqual({
      ok: true
    })
    expect(answer(store, { command: 'description', card: '.' })).toEqual({
      ok: true,
      output: `${text}\n`
    })
  })

  it('answers the resolution errors', () => {
    const store = setup()
    expect(answer(store, { command: 'description', card: 'ghost' })).toEqual({
      ok: false,
      error: 'board: no card "ghost" in this workspace'
    })
  })
})

describe('answerBoardCommand across workspaces (#69 D6–D9, D11)', () => {
  const ws = (
    id: string,
    name: string,
    cards: Card[],
    over: Partial<Workspace> = {}
  ): Workspace => ({
    ...workspace(id, cards),
    name,
    columns: [
      { id: `${id}-todo`, name: 'Todo' },
      { id: `${id}-doing`, name: 'Doing' }
    ],
    ...over
  })
  const agentCard = (id: string, columnId: string, startup: Card['startup'], title = id): Card => ({
    ...card(id, columnId, title),
    startup
  })
  const ids = { alpha: 'w-alpha', beta: 'w-beta', remote: 'w-remote' }

  function crossSetup(extra: Workspace[] = []): InMemoryWorkspaceStore {
    const state: WorkspaceState = {
      workspaces: [
        ws(ids.alpha, 'Alpha', [
          agentCard('a-claude', `${ids.alpha}-todo`, { kind: 'claude' }),
          agentCard('a-codex', `${ids.alpha}-todo`, { kind: 'codex' }),
          agentCard('a-custom', `${ids.alpha}-todo`, { kind: 'custom', command: ':' }),
          agentCard('a-shell', `${ids.alpha}-todo`, { kind: 'shell' })
        ]),
        ws(
          ids.beta,
          'Beta',
          [agentCard('b-port', `${ids.beta}-todo`, { kind: 'claude' }, 'Port Y')],
          {
            directory: '/tmp/bikube-beta',
            defaultStartup: { kind: 'opencode' }
          }
        ),
        ws(
          ids.remote,
          'Remote',
          [{ ...agentCard('r-1', `${ids.remote}-todo`, { kind: 'claude' }), host: 'devbox' }],
          { host: 'devbox', directory: '/srv/app' }
        ),
        ...extra
      ],
      activeId: ids.beta
    }
    return new InMemoryWorkspaceStore({ initialState: state })
  }
  const answer = (
    store: InMemoryWorkspaceStore,
    calling: string,
    command: Parameters<typeof answerBoardCommand>[2]
  ): ReturnType<typeof answerBoardCommand> =>
    answerBoardCommand(
      store,
      calling,
      command,
      () => true,
      () => {}
    )
  const cardOf = (store: InMemoryWorkspaceStore, id: string): Card | undefined =>
    store
      .getState()
      .workspaces.flatMap((w) => w.cards)
      .find((c) => c.id === id)
  const lastOf = (store: InMemoryWorkspaceStore, workspaceId: string): Card | undefined =>
    store
      .getState()
      .workspaces.find((w) => w.id === workspaceId)
      ?.cards.at(-1)

  it("lists every workspace in sidebar order, marking the calling card's (AC5)", () => {
    const store = crossSetup()
    expect(answer(store, 'a-claude', { command: 'workspaces', format: 'text' })).toEqual({
      ok: true,
      output: [
        `${ids.alpha}  Alpha  local  /tmp/bikube-${ids.alpha}  *`,
        `${ids.beta}  Beta  local  /tmp/bikube-beta`,
        `${ids.remote}  Remote  ssh devbox  /srv/app`,
        ''
      ].join('\n')
    })
    const reply = answer(store, 'a-claude', { command: 'workspaces', format: 'json' })
    if (!reply.ok || reply.output === undefined) throw new Error('no output')
    expect(JSON.parse(reply.output)).toEqual([
      {
        id: ids.alpha,
        name: 'Alpha',
        location: 'local',
        directory: `/tmp/bikube-${ids.alpha}`,
        current: true
      },
      { id: ids.beta, name: 'Beta', location: 'local', directory: '/tmp/bikube-beta' },
      { id: ids.remote, name: 'Remote', location: 'ssh', host: 'devbox', directory: '/srv/app' }
    ])
  })

  it('creates in another workspace, printing its id and workspace, with the description and the New mark (AC6)', () => {
    const store = crossSetup()
    const reply = answer(store, 'a-claude', {
      command: 'create',
      workspace: 'beta',
      column: 'todo',
      title: 'Port X',
      description: '# Port\nDo X'
    })
    const created = lastOf(store, ids.beta)
    expect(reply).toEqual({ ok: true, output: `${created?.id} Beta\n` })
    expect(created).toMatchObject({
      columnId: `${ids.beta}-todo`,
      title: 'Port X',
      description: '# Port\nDo X',
      directory: '/tmp/bikube-beta',
      startup: { kind: 'claude' },
      claudeStarted: false,
      unopened: true
    })
  })

  it('creates in its own workspace without the New mark, and in an SSH workspace with its host (D8, D11)', () => {
    const store = crossSetup()
    answer(store, 'a-claude', { command: 'create', column: 'Todo', title: 'Here' })
    expect(lastOf(store, ids.alpha)).not.toHaveProperty('unopened')
    answer(store, 'a-claude', {
      command: 'create',
      workspace: ids.alpha,
      column: 'Todo',
      title: 'Here too'
    })
    expect(lastOf(store, ids.alpha)).not.toHaveProperty('unopened')
    answer(store, 'a-claude', {
      command: 'create',
      workspace: 'remote',
      column: 'Todo',
      title: 'R'
    })
    expect(lastOf(store, ids.remote)).toMatchObject({ host: 'devbox', directory: '/srv/app' })
  })

  it("gives the card the calling card's agent, else the workspace's default, or the one --agent names (AC8)", () => {
    const store = crossSetup()
    const create = (calling: string, agent?: 'gemini' | 'shell' | 'claude'): Card | undefined => {
      answer(store, calling, {
        command: 'create',
        workspace: 'Beta',
        column: 'Todo',
        title: 'T1',
        ...(agent && { agent })
      })
      return lastOf(store, ids.beta)
    }
    expect(create('a-codex')?.startup).toEqual({ kind: 'codex' })
    expect(create('a-claude')?.startup).toEqual({ kind: 'claude' })
    expect(create('a-custom')?.startup).toEqual({ kind: 'opencode' })
    expect(create('a-shell')?.startup).toEqual({ kind: 'opencode' })
    expect(create('a-codex', 'gemini')?.startup).toEqual({ kind: 'gemini' })
    expect(create('a-codex', 'claude')?.startup).toEqual({ kind: 'claude' })
    expect(create('a-claude', 'shell')?.startup).toEqual({ kind: 'shell' })
  })

  it("acts on another workspace's card by its id; the column is the card's workspace's (AC7)", () => {
    const store = crossSetup()
    const statuses: [string, string][] = []
    expect(
      answer(store, 'a-claude', { command: 'rename', card: 'b-port', title: 'Port Z' })
    ).toEqual({ ok: true })
    expect(cardOf(store, 'b-port')?.title).toBe('Port Z')
    expect(answer(store, 'a-claude', { command: 'move', card: 'b-port', column: 'Doing' })).toEqual(
      { ok: true }
    )
    expect(cardOf(store, 'b-port')?.columnId).toBe(`${ids.beta}-doing`)
    expect(
      answerBoardCommand(
        store,
        'a-claude',
        { command: 'status', card: 'b-port', text: 'queued' },
        () => true,
        (id, text) => statuses.push([id, text])
      )
    ).toEqual({ ok: true })
    expect(statuses).toEqual([['b-port', 'queued']])
    store.setCardDescription(ids.beta, 'b-port', 'Hello')
    expect(answer(store, 'a-claude', { command: 'description', card: 'b-port' })).toEqual({
      ok: true,
      output: 'Hello\n'
    })
    expect(
      answer(store, 'a-claude', { command: 'describe', card: 'b-port', description: 'New' })
    ).toEqual({ ok: true })
    expect(cardOf(store, 'b-port')?.description).toBe('New')
  })

  it('resolves titles only in the calling workspace, or the one --workspace names (AC7)', () => {
    const store = crossSetup()
    expect(answer(store, 'a-claude', { command: 'rename', card: 'Port Y', title: 'Z' })).toEqual({
      ok: false,
      error: 'board: no card "Port Y" in this workspace'
    })
    expect(
      answer(store, 'a-claude', {
        command: 'rename',
        card: 'Port Y',
        title: 'Z',
        workspace: 'Beta'
      })
    ).toEqual({ ok: true })
    expect(cardOf(store, 'b-port')?.title).toBe('Z')
    expect(
      answer(store, 'a-claude', { command: 'move', card: 'Z', column: 'doing', workspace: 'beta' })
    ).toEqual({
      ok: true
    })
    expect(cardOf(store, 'b-port')?.columnId).toBe(`${ids.beta}-doing`)
    // `.` is the calling card whichever workspace is named.
    expect(
      answer(store, 'a-claude', { command: 'move', card: '.', column: 'Doing', workspace: 'Beta' })
    ).toEqual({ ok: true })
    expect(cardOf(store, 'a-claude')?.columnId).toBe(`${ids.alpha}-doing`)
  })

  it("lists the workspace --workspace names, each card's description flagged (AC7, D7)", () => {
    const store = crossSetup()
    store.setCardDescription(ids.beta, 'b-port', 'Hello')
    const reply = answer(store, 'a-claude', { command: 'list', format: 'json', workspace: 'Beta' })
    if (!reply.ok || reply.output === undefined) throw new Error('no output')
    const listing = JSON.parse(reply.output)
    expect(listing.workspace.name).toBe('Beta')
    expect(listing.columns[0].cards).toEqual([
      { id: 'b-port', title: 'Port Y', state: 'running', hasDescription: true }
    ])
    expect(
      answer(store, 'a-claude', { command: 'list', format: 'text', workspace: 'Beta' })
    ).toEqual({
      ok: true,
      output: [
        'Beta (/tmp/bikube-beta)',
        '',
        'Todo (1)',
        '  Port Y  [b-port]  running · description',
        '',
        'Doing (0)',
        ''
      ].join('\n')
    })
  })

  it('refuses a workspace that names none or several, changing nothing (AC7)', () => {
    const store = crossSetup([ws('w-beta2', 'beta', [])])
    const before = store.getState()
    expect(
      answer(store, 'a-claude', { command: 'list', format: 'text', workspace: 'nope' })
    ).toEqual({
      ok: false,
      error: 'board: no workspace named nope'
    })
    expect(
      answer(store, 'a-claude', {
        command: 'create',
        column: 'Todo',
        title: 'x',
        workspace: 'Beta'
      })
    ).toEqual({ ok: false, error: 'board: 2 workspaces are named Beta; use its id' })
    expect(store.getState()).toBe(before)
  })

  it("keeps an SSH card to its own workspace: no other workspace's ids, no --workspace, workspaces, create, rename or describe (D9)", () => {
    const store = crossSetup()
    const before = store.getState()
    expect(answer(store, 'r-1', { command: 'move', card: 'b-port', column: 'Doing' })).toEqual({
      ok: false,
      error: 'board: no card "b-port" in this workspace'
    })
    for (const command of [
      { command: 'workspaces', format: 'text' },
      { command: 'list', format: 'text', workspace: 'Beta' },
      { command: 'create', column: 'Todo', title: 'x' },
      { command: 'rename', card: '.', title: 'x' },
      { command: 'describe', card: '.', description: 'x' }
    ] as const) {
      expect(answer(store, 'r-1', command)).toEqual({ ok: false, error: 'board: invalid request' })
    }
    expect(store.getState()).toBe(before)
    expect(answer(store, 'r-1', { command: 'move', card: '.', column: 'Doing' })).toEqual({
      ok: true
    })
  })

  it('keeps activity to the calling workspace (D7)', () => {
    const store = crossSetup()
    expect(
      answer(store, 'a-claude', { command: 'activity', card: 'b-port', activity: 'working' })
    ).toEqual({ ok: false, error: 'board: no card "b-port" in this workspace' })
  })
})
