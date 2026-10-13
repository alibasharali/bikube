import { describe, expect, it } from 'vitest'
import { answerBoardCommand } from './board-answer'
import { NOT_IN_A_CARD } from './board-commands'
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
  directory: '/tmp/drovr-alpha',
  startup: { kind: 'shell' },
  agentSessionId: 'x',
  claudeStarted: false
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
  defaultStartup: { kind: 'shell' }
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
      running
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
        running
      )
    ).toEqual({ ok: true })
    expect(columnOf(store, 'c-web')).toBe('needs')
    expect(columnOf(store, 'c-api')).toBe('backlog')
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'c-web', column: 'Running' },
        running
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
        running
      )
    ).toEqual({ ok: true })
    expect(store.getState()).toBe(before)
  })

  it('answers the resolution errors and moves nothing (#9 AC3, AC4)', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(store, 'c-api', { command: 'move', card: '.', column: 'Review' }, running)
    ).toEqual({
      ok: false,
      error: 'board: no column "Review"; columns are: Backlog, Running, Needs me, Done'
    })
    expect(
      answerBoardCommand(
        store,
        'c-api',
        { command: 'move', card: 'other', column: 'Done' },
        running
      )
    ).toEqual({ ok: false, error: 'board: no card "other" in this workspace' })
    expect(store.getState()).toBe(before)
  })

  it('refuses a calling card the board does not have (#9 D3)', () => {
    const store = setup()
    expect(
      answerBoardCommand(store, 'ghost', { command: 'move', card: '.', column: 'Done' }, running)
    ).toEqual({ ok: false, error: NOT_IN_A_CARD })
  })

  it('accepts status for a running card and refuses it for one that is not (#9 D8)', () => {
    const store = setup()
    const before = store.getState()
    expect(
      answerBoardCommand(store, 'c-api', { command: 'status', card: '.', text: 'hi' }, running)
    ).toEqual({ ok: true })
    expect(
      answerBoardCommand(store, 'c-api', { command: 'status', card: 'old', text: 'hi' }, running)
    ).toEqual({ ok: false, error: 'board: "old" is not running' })
    expect(store.getState()).toBe(before)
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
})
