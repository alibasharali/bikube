import { describe, expect, it } from 'vitest'
import {
  answerBoardCommand,
  answerBoardRequest,
  checkCreateWorktree,
  type OrchestratorAnswers,
  type RepoBranches
} from './board-answer'
import type { BoardCommand } from './board-args'
import type { ActionRow, PaletteAction, PaletteItems } from './palette'
import {
  NOT_IN_A_CARD,
  ONLY_ORCHESTRATOR,
  ORCHESTRATOR_NOT_A_CARD,
  SHELL_NOT_A_CARD
} from './board-commands'
import type { StartOutcome } from './board-start'
import { orchestratorGuide } from './orchestrator-guide'
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
    const create = (calling: string, agent?: 'gemini' | 'claude'): Card | undefined => {
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

  describe('create --worktree (#69 D10, AC9)', () => {
    const repo = (branches: string[] | null): { asked: string[]; info: RepoBranches } => {
      const asked: string[] = []
      return {
        asked,
        info: async (dir: string): Promise<{ branches: string[] } | null> => {
          asked.push(dir)
          return branches && { branches }
        }
      }
    }
    const create = (over: object = {}) =>
      ({
        command: 'create',
        column: 'Todo',
        title: 'Port X',
        workspace: 'Beta',
        worktree: true,
        ...over
      }) as const

    it('fills in the branch given, or the one suggested from the title, and leaves other commands as they are', async () => {
      const store = crossSetup()
      const git = repo(['main', 'bikube/port-x'])
      expect(
        await checkCreateWorktree(
          store.getState(),
          'a-claude',
          create({ branch: 'port-x' }),
          git.info
        )
      ).toEqual({ ok: true, command: create({ branch: 'port-x' }) })
      expect(git.asked).toEqual(['/tmp/bikube-beta'])
      expect(await checkCreateWorktree(store.getState(), 'a-claude', create(), git.info)).toEqual({
        ok: true,
        command: create({ branch: 'bikube/port-x-2' })
      })
      const plain = { command: 'create', column: 'Todo', title: 'x' } as const
      const none = repo(null)
      expect(await checkCreateWorktree(store.getState(), 'a-claude', plain, none.info)).toEqual({
        ok: true,
        command: plain
      })
      expect(none.asked).toEqual([])
    })

    it('refuses an SSH workspace, a folder outside git, a bad name and a branch that exists, asking git nothing for the first and third', async () => {
      const store = crossSetup()
      const git = repo(['main'])
      expect(
        await checkCreateWorktree(
          store.getState(),
          'a-claude',
          create({ workspace: 'Remote' }),
          git.info
        )
      ).toEqual({ ok: false, error: 'board: Remote is an SSH workspace' })
      expect(
        await checkCreateWorktree(store.getState(), 'a-claude', create({ branch: 'a b' }), git.info)
      ).toEqual({ ok: false, error: 'board: Not a valid branch name' })
      expect(git.asked).toEqual([])
      expect(
        await checkCreateWorktree(
          store.getState(),
          'a-claude',
          create({ branch: 'main' }),
          git.info
        )
      ).toEqual({ ok: false, error: "board: a branch named 'main' already exists" })
      expect(
        await checkCreateWorktree(store.getState(), 'a-claude', create(), repo(null).info)
      ).toEqual({
        ok: false,
        error: 'board: /tmp/bikube-beta is not in a git repository'
      })
      expect(
        await checkCreateWorktree(
          store.getState(),
          'a-claude',
          create({ workspace: 'nope' }),
          git.info
        )
      ).toEqual({ ok: false, error: 'board: no workspace named nope' })
      expect(
        await checkCreateWorktree(
          store.getState(),
          'a-claude',
          create({ column: 'Nope' }),
          git.info
        )
      ).toMatchObject({ ok: false })
    })

    it('creates the card with its pending worktree in the workspace folder, no worktree yet', () => {
      const store = crossSetup()
      const reply = answer(store, 'a-claude', create({ branch: 'port-x' }))
      expect(reply).toMatchObject({ ok: true })
      const made = lastOf(store, ids.beta)
      expect(made?.title).toBe('Port X')
      expect(made?.pendingWorktree).toEqual({ branch: 'port-x' })
      expect(made?.directory).toBe('/tmp/bikube-beta')
      expect(made).not.toHaveProperty('worktree')
    })

    it('refuses a worktree whose branch was never checked, creating nothing', () => {
      const store = crossSetup()
      const before = store.getState()
      expect(answer(store, 'a-claude', create())).toEqual({
        ok: false,
        error: 'board: invalid request'
      })
      expect(store.getState()).toBe(before)
    })
  })
})

describe('answerBoardCommand from a workspace shell', () => {
  const shellStore = (): InMemoryWorkspaceStore => {
    const store = setup()
    const state = store.getState()
    const alpha = state.workspaces[0]
    return new InMemoryWorkspaceStore({
      initialState: {
        ...state,
        workspaces: [
          {
            ...alpha,
            shells: [
              {
                id: 's-dev',
                name: 'Terminal 1',
                command: '',
                autostart: false,
                type: 'shell',
                temporary: true
              },
              { id: 's-build', name: 'Build', command: '', autostart: false, type: 'shell' }
            ]
          },
          state.workspaces[1]
        ]
      }
    })
  }
  const answer = (
    store: InMemoryWorkspaceStore,
    from: string,
    command: Parameters<typeof answerBoardCommand>[2]
  ): ReturnType<typeof answerBoardCommand> =>
    answerBoardCommand(store, from, command, running, () => {})

  it("lists and creates in the shell's workspace, the new card with the workspace's agent", () => {
    const store = shellStore()
    const listed = answer(store, 's-dev', { command: 'list', format: 'json' })
    if (!listed.ok || listed.output === undefined) throw new Error('no output')
    expect(JSON.parse(listed.output).workspace.id).toBe('alpha')

    const created = answer(store, 's-dev', { command: 'create', column: 'Backlog', title: 'Docs' })
    expect(created).toMatchObject({ ok: true, output: expect.stringMatching(/ alpha\n$/) })
    const card = store.getState().workspaces[0].cards.find((c) => c.title === 'Docs')
    expect(card?.startup).toEqual({ kind: 'claude' })
    expect(card?.unopened).toBeUndefined()
  })

  it('moves a named card; refuses moving or describing `.`, since a shell is no card', () => {
    const store = shellStore()
    const from = 's-build'
    expect(answer(store, from, { command: 'move', card: 'api', column: 'Done' })).toEqual({
      ok: true
    })
    expect(columnOf(store, 'c-api')).toBe('done')
    expect(answer(store, from, { command: 'move', card: '.', column: 'Done' })).toEqual({
      ok: false,
      error: SHELL_NOT_A_CARD
    })
    expect(answer(store, from, { command: 'describe', card: '.', description: 'x' })).toEqual({
      ok: false,
      error: SHELL_NOT_A_CARD
    })
  })

  it("sets a shell's own status and activity, and takes its session and description quietly", () => {
    const store = shellStore()
    const statuses: [string, string][] = []
    const activities: [string, string | null][] = []
    const ask = (command: Parameters<typeof answerBoardCommand>[2]): unknown =>
      answerBoardCommand(
        store,
        's-dev',
        command,
        running,
        (id, text) => statuses.push([id, text]),
        (id, activity) => activities.push([id, activity])
      )
    expect(ask({ command: 'status', card: '.', text: 'Tests green' })).toEqual({ ok: true })
    expect(ask({ command: 'activity', card: '.', activity: 'waiting' })).toEqual({ ok: true })
    expect(ask({ command: 'activity', card: '.', activity: 'none' })).toEqual({ ok: true })
    expect(statuses).toEqual([['s-dev', 'Tests green']])
    expect(activities).toEqual([
      ['s-dev', 'waiting'],
      ['s-dev', null]
    ])
    expect(ask({ command: 'description', card: '.' })).toEqual({ ok: true })
    expect(
      ask({ command: 'session', card: '.', session: '0b8c3a1e-1111-4222-8333-444455556666' })
    ).toEqual({ ok: true })
    // Nothing of it is kept in the store: a shell has no saved status.
    expect(store.getState().workspaces[0].cards.every((c) => c.lastStatus === undefined)).toBe(true)
  })

  it("hands a running shell's session and usage on, runtime only (#75 D3a)", () => {
    const store = shellStore()
    const before = store.getState()
    const sessions: [string, string][] = []
    const usages: [string, ClaudeUsage][] = []
    const usage: ClaudeUsage = {
      input: 1,
      output: 2,
      cacheWrite: 0,
      cacheRead: 0,
      tokens: 3,
      context: 1,
      model: null
    }
    const ask = (from: string, command: Parameters<typeof answerBoardCommand>[2]): unknown =>
      answerBoardCommand(
        store,
        from,
        command,
        (id) => id !== 's-dev',
        () => {},
        () => {},
        () => {},
        (id, next) => usages.push([id, next]),
        undefined,
        (id, session) => sessions.push([id, session])
      )
    const from = 's-build'
    const SESSION = '0B8C3A1E-1111-4222-8333-444455556666'
    expect(ask(from, { command: 'session', card: '.', session: SESSION })).toEqual({ ok: true })
    expect(ask(from, { command: 'usage', card: '.', usage })).toEqual({ ok: true })
    expect(sessions).toEqual([[from, SESSION.toLowerCase()]])
    expect(usages).toEqual([[from, usage]])
    // A stopped shell keeps nothing.
    expect(ask('s-dev', { command: 'session', card: '.', session: SESSION })).toEqual({
      ok: false,
      error: SHELL_NOT_A_CARD
    })
    expect(ask('s-dev', { command: 'usage', card: '.', usage })).toEqual({
      ok: false,
      error: SHELL_NOT_A_CARD
    })
    expect(sessions).toHaveLength(1)
    expect(usages).toHaveLength(1)
    expect(store.getState()).toBe(before)
  })

  it('still refuses a terminal that is neither a card nor a shell, a Default shell id too (#81 D1)', () => {
    for (const from of ['default-shell:gone', 'default-shell:alpha']) {
      expect(answer(shellStore(), from, { command: 'workspaces', format: 'text' })).toEqual({
        ok: false,
        error: NOT_IN_A_CARD
      })
    }
  })
})

describe('answerBoardCommand from the Orchestrator (#81 D8, D9, D16)', () => {
  const FROM = 'orchestrator:alpha'
  const SESSION = '0B8C3A1E-1111-4222-8333-444455556666'
  const orchestratorStore = (): InMemoryWorkspaceStore => {
    const store = setup()
    store.ensureOrchestrator('alpha')
    return store
  }

  it("lists its workspace and creates with the target workspace's default agent", () => {
    const store = orchestratorStore()
    store.updateWorkspace('beta', { defaultStartup: { kind: 'codex' } })
    const answer = (command: Parameters<typeof answerBoardCommand>[2]): unknown =>
      answerBoardCommand(store, FROM, command, running, () => {})
    const listed = answer({ command: 'list', format: 'json' }) as { ok: true; output: string }
    expect(JSON.parse(listed.output).workspace.id).toBe('alpha')
    expect(answer({ command: 'create', column: 'Backlog', title: 'Docs' })).toMatchObject({
      ok: true
    })
    expect(
      answer({ command: 'create', column: 'Backlog', title: 'Other', workspace: 'beta' })
    ).toMatchObject({ ok: true })
    const docs = store.getState().workspaces[0].cards.find((c) => c.title === 'Docs')
    expect(docs?.startup).toEqual({ kind: 'claude' })
    const other = store.getState().workspaces[1].cards.find((c) => c.title === 'Other')
    expect(other?.startup).toEqual({ kind: 'codex' })
    expect(other?.unopened).toBe(true)
  })

  it('sets its own status, activity and usage at runtime and its session in the store', () => {
    const store = orchestratorStore()
    const statuses: [string, string][] = []
    const activities: [string, string | null][] = []
    const usages: string[] = []
    const usage: ClaudeUsage = {
      input: 1,
      output: 2,
      cacheWrite: 0,
      cacheRead: 0,
      tokens: 3,
      context: 1,
      model: null
    }
    const ask = (command: Parameters<typeof answerBoardCommand>[2]): unknown =>
      answerBoardCommand(
        store,
        FROM,
        command,
        () => true,
        (id, text) => statuses.push([id, text]),
        (id, activity) => activities.push([id, activity]),
        () => {},
        (id) => usages.push(id)
      )
    expect(ask({ command: 'status', card: '.', text: 'Planning' })).toEqual({ ok: true })
    expect(ask({ command: 'activity', card: '.', activity: 'waiting' })).toEqual({ ok: true })
    expect(ask({ command: 'usage', card: '.', usage })).toEqual({ ok: true })
    expect(ask({ command: 'description', card: '.' })).toEqual({ ok: true })
    expect(ask({ command: 'session', card: '.', session: SESSION })).toEqual({ ok: true })
    expect(statuses).toEqual([[FROM, 'Planning']])
    expect(activities).toEqual([[FROM, 'waiting']])
    expect(usages).toEqual([FROM])
    expect(store.getState().workspaces[0].orchestrator).toMatchObject({
      agentSessionId: SESSION.toLowerCase(),
      claudeStarted: true
    })
    expect(store.getState().workspaces[0].cards.every((c) => c.lastStatus === undefined)).toBe(true)
  })

  it('moves a named card but refuses moving, renaming or describing `.`', () => {
    const store = orchestratorStore()
    const answer = (command: Parameters<typeof answerBoardCommand>[2]): unknown =>
      answerBoardCommand(store, FROM, command, running, () => {})
    expect(answer({ command: 'move', card: 'api', column: 'Done' })).toEqual({ ok: true })
    expect(columnOf(store, 'c-api')).toBe('done')
    for (const command of [
      { command: 'move', card: '.', column: 'Done' },
      { command: 'rename', card: '.', title: 'x' },
      { command: 'describe', card: '.', description: 'x' }
    ] as const) {
      expect(answer(command)).toEqual({ ok: false, error: ORCHESTRATOR_NOT_A_CARD })
    }
  })

  it("refuses an SSH workspace's or an unknown workspace's Orchestrator id", () => {
    const store = setup()
    store.updateWorkspace('beta', { host: 'box', directory: '~' })
    for (const from of ['orchestrator:beta', 'orchestrator:gone']) {
      expect(
        answerBoardCommand(
          store,
          from,
          { command: 'workspaces', format: 'text' },
          running,
          () => {}
        )
      ).toEqual({ ok: false, error: NOT_IN_A_CARD })
    }
  })
})

describe('board guide (#81 D13, D16)', () => {
  const guide = { command: 'guide' } as const
  const ask = (store: InMemoryWorkspaceStore, from: string, instructions?: () => string): unknown =>
    answerBoardCommand(
      store,
      from,
      guide,
      running,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      instructions ? { instructions } : undefined
    )

  it("prints the guide with the Orchestrator's workspace and folder, then the user's text, read at each run", () => {
    const store = setup()
    store.ensureOrchestrator('alpha')
    let text = 'Always use worktrees.'
    expect(ask(store, 'orchestrator:alpha', () => text)).toEqual({
      ok: true,
      output: orchestratorGuide('alpha', '/tmp/bikube-alpha', 'Always use worktrees.')
    })
    text = ''
    expect(ask(store, 'orchestrator:alpha', () => text)).toEqual({
      ok: true,
      output: orchestratorGuide('alpha', '/tmp/bikube-alpha', '')
    })
    expect(ask(store, 'orchestrator:alpha')).toEqual({
      ok: true,
      output: orchestratorGuide('alpha', '/tmp/bikube-alpha', '')
    })
  })

  it('refuses every orchestrator-only command from a card or a shell', () => {
    const store = setup()
    const shell = store.createTemporaryShell('alpha')
    const shellId = shell.ok ? shell.value.id : ''
    for (const from of ['c-api', shellId]) {
      for (const command of [
        guide,
        { command: 'start', card: 'api' },
        { command: 'palette', action: 'list' }
      ] as const) {
        expect(answerBoardCommand(store, from, command, running, () => {})).toEqual({
          ok: false,
          error: ONLY_ORCHESTRATOR
        })
      }
    }
  })
})

describe('board palette (#81 D23, AC12)', () => {
  const action = (id: 'agentSetup' | 'back' | 'settings', label: string): ActionRow => ({
    kind: 'action',
    action: { id },
    label
  })
  const items: PaletteItems = {
    cards: [],
    shells: [],
    actions: [
      action('back', 'Back to board'),
      action('agentSetup', 'Agent setup'),
      action('settings', 'Open Settings')
    ]
  }
  function ask(
    command: BoardCommand,
    from = 'orchestrator:alpha'
  ): { reply: unknown; ran: PaletteAction[] } {
    const store = setup()
    store.ensureOrchestrator('alpha')
    const ran: PaletteAction[] = []
    const reply = answerBoardCommand(
      store,
      from,
      command,
      running,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { palette: () => items, runPalette: (a) => ran.push(a) }
    )
    return { reply, ran }
  }

  it("lists the palette's rows for the Orchestrator, one label per line, Back left out", () => {
    expect(ask({ command: 'palette', action: 'list' })).toEqual({
      reply: { ok: true, output: 'Agent setup\nOpen Settings\n' },
      ran: []
    })
  })

  it('runs the row its label names, in any case after trimming, printing nothing', () => {
    expect(ask({ command: 'palette', action: 'run', label: ' agent SETUP ' })).toEqual({
      reply: { ok: true },
      ran: [{ id: 'agentSetup' }]
    })
  })

  it('refuses a label no listed row has, running nothing', () => {
    for (const label of ['nope', 'Back to board']) {
      expect(ask({ command: 'palette', action: 'run', label })).toEqual({
        reply: { ok: false, error: `board: no palette row "${label}"` },
        ran: []
      })
    }
  })
})

describe('board start, open and terminal (#81 D17, D22)', () => {
  const FROM = 'orchestrator:alpha'
  type Command = BoardCommand
  const orchestratorStore = (): InMemoryWorkspaceStore => {
    const store = setup()
    store.ensureOrchestrator('alpha')
    return store
  }
  /** Answers `command` from the Orchestrator, recording its starts and opens. */
  function asker(
    store: InMemoryWorkspaceStore,
    outcome: StartOutcome = { ok: true },
    isRunning: (id: string) => boolean = (id) => id === 'c-web'
  ): {
    ask: (command: Command) => Promise<unknown>
    starts: string[]
    opens: string[]
  } {
    const starts: string[] = []
    const opens: string[] = []
    const ask = async (command: Command): Promise<unknown> =>
      answerBoardRequest(
        store,
        FROM,
        command,
        isRunning,
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          start: async (workspaceId, cardId) => {
            starts.push(`${workspaceId}/${cardId}`)
            return outcome
          },
          open: (workspaceId, cardId) => opens.push(`${workspaceId}/${cardId}`)
        }
      )
    return { ask, starts, opens }
  }

  it('starts a stopped card by id in any workspace, never opening it', async () => {
    const { ask, starts, opens } = asker(orchestratorStore())
    expect(await ask({ command: 'start', card: 'c-other' })).toEqual({ ok: true })
    expect(starts).toEqual(['beta/c-other'])
    expect(opens).toEqual([])
  })

  it("resolves a title in the active workspace, or --workspace's", async () => {
    const { ask, starts } = asker(orchestratorStore())
    // beta is active.
    expect(await ask({ command: 'start', card: 'other' })).toEqual({ ok: true })
    expect(await ask({ command: 'start', card: 'api' })).toMatchObject({ ok: false })
    expect(await ask({ command: 'start', card: 'api', workspace: 'alpha' })).toEqual({ ok: true })
    expect(starts).toEqual(['beta/c-other', 'alpha/c-api'])
  })

  it('prints that a running card is already running, starting nothing', async () => {
    const { ask, starts } = asker(orchestratorStore())
    expect(await ask({ command: 'start', card: 'c-web' })).toEqual({
      ok: true,
      output: 'web is already running\n'
    })
    expect(starts).toEqual([])
  })

  it("refuses a start that fails, with its reason, and doesn't open it", async () => {
    const { ask, opens } = asker(orchestratorStore(), { ok: false, reason: 'no such folder' })
    const refused = { ok: false, error: 'board: "other" couldn\'t start: no such folder' }
    expect(await ask({ command: 'start', card: 'c-other' })).toEqual(refused)
    expect(await ask({ command: 'open', card: 'c-other' })).toEqual(refused)
    expect(opens).toEqual([])
  })

  it('opens a card after starting it, and a running one at once', async () => {
    const { ask, starts, opens } = asker(orchestratorStore())
    expect(await ask({ command: 'open', card: 'c-other' })).toEqual({ ok: true })
    expect(await ask({ command: 'open', card: 'c-web' })).toEqual({ ok: true })
    expect(starts).toEqual(['beta/c-other'])
    expect(opens).toEqual(['beta/c-other', 'alpha/c-web'])
  })

  it('adds a temporary terminal typing the command in the active workspace, started', async () => {
    const store = orchestratorStore()
    const { ask, starts, opens } = asker(store)
    const reply = (await ask({ command: 'terminal', line: 'printf ready' })) as {
      ok: true
      output: string
    }
    const shell = store.getState().workspaces[1].shells[0]
    expect(shell).toMatchObject({ name: 'Terminal 1', command: 'printf ready', temporary: true })
    expect(reply).toEqual({ ok: true, output: `Terminal 1 ${shell.id}\n` })
    expect(starts).toEqual([`beta/${shell.id}`])
    expect(opens).toEqual([])
  })

  it("opens it with --show, in --workspace's workspace", async () => {
    const store = orchestratorStore()
    const { ask, opens } = asker(store)
    await ask({ command: 'terminal', line: 'exec sleep 60', workspace: 'alpha', show: true })
    const shell = store.getState().workspaces[0].shells[0]
    expect(shell.name).toBe('Terminal 1')
    expect(opens).toEqual([`alpha/${shell.id}`])
  })

  it('refuses a command on two lines, and a terminal that fails to start', async () => {
    const store = orchestratorStore()
    expect(await asker(store).ask({ command: 'terminal', line: 'a\nb' })).toEqual({
      ok: false,
      error: 'board: Command must be one line'
    })
    expect(store.getState().workspaces[1].shells).toEqual([])
    const failing = asker(store, { ok: false, reason: 'spawn failed' })
    expect(await failing.ask({ command: 'terminal', line: 'ls', show: true })).toEqual({
      ok: false,
      error: 'board: "Terminal 1" couldn\'t start: spawn failed'
    })
    expect(failing.opens).toEqual([])
  })

  it('refuses them from a card, starting nothing', async () => {
    const store = orchestratorStore()
    const starts: string[] = []
    const reply = await answerBoardRequest(
      store,
      'c-api',
      { command: 'start', card: 'c-other' },
      running,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        start: async (_, id) => {
          starts.push(id)
          return { ok: true }
        }
      }
    )
    expect(reply).toEqual({ ok: false, error: ONLY_ORCHESTRATOR })
    expect(starts).toEqual([])
  })

  it('prints that a start undecided at its limit is still starting, opening it for open', async () => {
    const { ask, opens } = asker(orchestratorStore(), { ok: true, pending: true })
    expect(await ask({ command: 'start', card: 'c-other' })).toEqual({
      ok: true,
      output: 'other is still starting\n'
    })
    expect(await ask({ command: 'open', card: 'c-other' })).toEqual({
      ok: true,
      output: 'other is still starting\n'
    })
    expect(opens).toEqual(['beta/c-other'])
  })

  it("marks the cards it creates orchestrated, and no other caller's (D18)", () => {
    const store = orchestratorStore()
    answerBoardCommand(
      store,
      FROM,
      { command: 'create', column: 'Backlog', title: 'Review' },
      running,
      () => {}
    )
    answerBoardCommand(
      store,
      'c-api',
      { command: 'create', column: 'Backlog', title: 'Mine' },
      running,
      () => {}
    )
    const cards = store.getState().workspaces[0].cards
    expect(cards.find((c) => c.title === 'Review')?.orchestrated).toBe(true)
    expect(cards.find((c) => c.title === 'Mine')).not.toHaveProperty('orchestrated')
  })
})

describe('board send, wait and reply (#81 D19–D21)', () => {
  const FROM = 'orchestrator:alpha'
  const SESSION = '11111111-2222-4333-8444-555555555555'
  const orchestratorStore = (): InMemoryWorkspaceStore => {
    const store = setup()
    store.ensureOrchestrator('alpha')
    return store
  }
  function asker(
    store: InMemoryWorkspaceStore,
    answers: OrchestratorAnswers,
    isRunning: (id: string) => boolean = (id) => id !== 'c-old'
  ): (command: BoardCommand, from?: string) => Promise<unknown> {
    return async (command, from = FROM) =>
      answerBoardRequest(
        store,
        from,
        command,
        isRunning,
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        answers
      )
  }

  it("types a running card's cleaned text, by id or by title in the active workspace", async () => {
    const sent: string[] = []
    const ask = asker(orchestratorStore(), {
      send: async (cardId, text) => {
        sent.push(`${cardId}:${text}`)
      }
    })
    expect(await ask({ command: 'send', card: 'c-api', text: 'go\x1b on\n' })).toEqual({ ok: true })
    // beta is active.
    expect(await ask({ command: 'send', card: 'other', text: 'hi' })).toEqual({ ok: true })
    expect(sent).toEqual(['c-api:go on\n', 'c-other:hi'])
  })

  it("refuses a card that isn't running, and a text over 100,000 characters, typing nothing", async () => {
    const sent: string[] = []
    const ask = asker(orchestratorStore(), { send: async (id) => void sent.push(id) })
    expect(await ask({ command: 'send', card: 'c-old', text: 'go on' })).toEqual({
      ok: false,
      error: 'board: "old" is not running'
    })
    expect(await ask({ command: 'send', card: 'c-api', text: 'a'.repeat(100_001) })).toEqual({
      ok: false,
      error: 'board: the text is longer than 100,000 characters'
    })
    expect(sent).toEqual([])
  })

  it('prints what the wait ended on, or refuses its timeout', async () => {
    const waits: string[] = []
    let result: 'waiting' | 'timeout' = 'waiting'
    const ask = asker(orchestratorStore(), {
      wait: async (cardId, seconds) => {
        waits.push(`${cardId}:${seconds}`)
        return result
      }
    })
    expect(await ask({ command: 'wait', card: 'c-api', timeout: 5 })).toEqual({
      ok: true,
      output: 'waiting\n'
    })
    result = 'timeout'
    expect(await ask({ command: 'wait', card: 'c-old' })).toEqual({
      ok: false,
      error: 'board: timed out after 600 s'
    })
    expect(waits).toEqual(['c-api:5', 'c-old:600'])
  })

  it("prints a local Claude Code card's last reply from its folder and session", async () => {
    const store = orchestratorStore()
    const reads: string[] = []
    const ask = asker(store, {
      reply: async (folder, sessionId) => {
        reads.push(`${folder}:${sessionId}`)
        return { state: 'reply', text: 'Found 2 issues.' }
      }
    })
    const created = store.createCard('alpha', 'backlog', 'Review', { kind: 'claude' })
    if (!created.ok) throw new Error('not created')
    store.setAgentSession('alpha', created.value.id, SESSION)
    expect(await ask({ command: 'reply', card: created.value.id })).toEqual({
      ok: true,
      output: 'Found 2 issues.\n'
    })
    expect(reads).toEqual([`${created.value.directory}:${SESSION}`])
  })

  it('refuses a card that is not Claude Code, and one with no reply yet', async () => {
    const store = orchestratorStore()
    const ask = asker(store, { reply: async () => ({ state: 'none' }) })
    expect(await ask({ command: 'reply', card: 'c-api' })).toEqual({
      ok: false,
      error: 'board: "api" is not a Claude Code card'
    })
    const created = store.createCard('alpha', 'backlog', 'Review', { kind: 'claude' })
    if (!created.ok) throw new Error('not created')
    expect(await ask({ command: 'reply', card: created.value.id })).toEqual({
      ok: false,
      error: 'board: "Review" has no reply yet'
    })
  })

  it('refuses all three from a card', async () => {
    const ask = asker(orchestratorStore(), {})
    for (const command of [
      { command: 'send', card: 'c-web', text: 'x' },
      { command: 'wait', card: 'c-web' },
      { command: 'reply', card: 'c-web' }
    ] as const) {
      expect(await ask(command, 'c-api')).toEqual({ ok: false, error: ONLY_ORCHESTRATOR })
    }
  })
})
