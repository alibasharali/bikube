import { describe, expect, it } from 'vitest'
import type { Card, Workspace, WorkspaceState } from './workspace-store'
import {
  expandHome,
  joinBoards,
  parseSyncFile,
  portableDirectory,
  serializeSyncFile,
  toSyncBoard
} from './sync-file'

const HOME = '/tmp/ha'

function card(id: string, columnId: string, over: Partial<Card> = {}): Card {
  return {
    id,
    columnId,
    title: `Card ${id}`,
    directory: `${HOME}/proj`,
    startup: { kind: 'claude' },
    agentSessionId: `session-${id}`,
    claudeStarted: true,
    startedAgents: [],
    ...over
  }
}

function workspace(id: string, name: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    directory: `${HOME}/proj`,
    columns: [
      { id: `${id}-backlog`, name: 'Backlog' },
      { id: `${id}-running`, name: 'Running' }
    ],
    cards: [],
    nextCardNumber: 2,
    defaultStartup: { kind: 'claude' },
    shells: [],
    worktreeSetup: '',
    ...over
  }
}

describe('home mapping (#13 D5, AC5)', () => {
  it.each([
    ['/tmp/ha', '~'],
    ['/tmp/ha/', '~'],
    ['/tmp/ha/proj', '~/proj'],
    ['/tmp/ha/a/b', '~/a/b'],
    ['/tmp/hab/proj', '/tmp/hab/proj'],
    ['/srv/proj', '/srv/proj']
  ])('writes local %s as %s for home /tmp/ha', (dir, written) => {
    expect(portableDirectory(dir, '/tmp/ha')).toBe(written)
    expect(portableDirectory(dir, '/tmp/ha/')).toBe(written)
  })

  it.each([
    ['~', '/tmp/hb'],
    ['~/proj', '/tmp/hb/proj'],
    ['~/a/b', '/tmp/hb/a/b'],
    ['/srv/proj', '/srv/proj'],
    ['~other/proj', '~other/proj']
  ])('reads local %s as %s for home /tmp/hb', (dir, read) => {
    expect(expandHome(dir, '/tmp/hb')).toBe(read)
    expect(expandHome(dir, '/tmp/hb/')).toBe(read)
  })
})

describe('the board written to the sync file (#13 D2, D3, D5, D6, AC1, AC5)', () => {
  const api = workspace('api', 'api', {
    cards: [card('c1', 'api-backlog', { title: 'Terminal 1' })]
  })
  const srv = workspace('srv', 'srv', {
    directory: '~/srv',
    host: 'devbox',
    cards: [card('c2', 'srv-running', { directory: '~/srv', host: 'devbox' })]
  })
  const state: WorkspaceState = { workspaces: [api, srv], activeId: 'srv' }

  it('holds every workspace without the active one, local directories mapped to ~', () => {
    const board = toSyncBoard(state, HOME)
    expect(board).not.toHaveProperty('activeId')
    expect(board.workspaces.map((w) => w.name)).toEqual(['api', 'srv'])
    expect(board.workspaces[0]).toEqual({
      ...api,
      directory: '~/proj',
      cards: [{ ...api.cards[0], directory: '~/proj', claudeStarted: false }]
    })
  })

  it('writes local cards with claudeStarted false and SSH ones as they are, directories unchanged', () => {
    const [, written] = toSyncBoard(state, HOME).workspaces
    expect(written).toEqual(srv)
    expect(written.cards[0].claudeStarted).toBe(true)
  })

  it("writes local cards' startedAgents empty and SSH ones' as they are (#21 D7)", () => {
    const started = toSyncBoard(
      {
        workspaces: [
          workspace('api', 'api', {
            cards: [
              card('l', 'api-backlog', { startup: { kind: 'codex' }, startedAgents: ['codex'] }),
              card('r', 'api-backlog', {
                host: 'devbox',
                startup: { kind: 'codex' },
                startedAgents: ['codex', 'gemini']
              })
            ]
          })
        ],
        activeId: 'api'
      },
      HOME
    ).workspaces[0].cards.map((c) => [c.id, c.startedAgents])
    expect(started).toEqual([
      ['l', []],
      ['r', ['codex', 'gemini']]
    ])
  })

  it('serializes version 1, savedAt in UTC and the board, and nothing else', () => {
    const board = toSyncBoard(state, HOME)
    const text = serializeSyncFile(board, new Date(Date.UTC(2026, 9, 14, 9, 5, 0)))
    expect(JSON.parse(text)).toEqual({
      version: 1,
      savedAt: '2026-10-14T09:05:00.000Z',
      board: JSON.parse(JSON.stringify(board))
    })
  })

  it('writes the same text for the same board whatever the key order in memory', () => {
    const reordered: Workspace = {
      worktreeSetup: api.worktreeSetup,
      shells: api.shells,
      defaultStartup: api.defaultStartup,
      nextCardNumber: api.nextCardNumber,
      cards: api.cards.map((c) => ({
        startedAgents: c.startedAgents,
        claudeStarted: c.claudeStarted,
        agentSessionId: c.agentSessionId,
        startup: c.startup,
        directory: c.directory,
        title: c.title,
        columnId: c.columnId,
        id: c.id
      })),
      columns: api.columns,
      directory: api.directory,
      name: api.name,
      id: api.id
    }
    const at = new Date(0)
    expect(
      serializeSyncFile(toSyncBoard({ workspaces: [reordered], activeId: 'api' }, HOME), at)
    ).toBe(serializeSyncFile(toSyncBoard({ workspaces: [api], activeId: 'api' }, HOME), at))
  })
})

describe('reading the sync file (#13 D3, D5, D6)', () => {
  const api = workspace('api', 'api', {
    cards: [card('c1', 'api-backlog', { title: 'Terminal 1' })]
  })
  const srv = workspace('srv', 'srv', {
    directory: '~/srv',
    host: 'devbox',
    cards: [card('c2', 'srv-running', { directory: '~/srv', host: 'devbox' })]
  })
  const written = serializeSyncFile(
    toSyncBoard({ workspaces: [api, srv], activeId: 'api' }, HOME),
    new Date(0)
  )
  const fileWith = (change: (file: Record<string, unknown>) => void): string => {
    const file = JSON.parse(written) as Record<string, unknown>
    change(file)
    return JSON.stringify(file)
  }

  it("expands local directories under this machine's home and keeps SSH ones", () => {
    const parsed = parseSyncFile(written, '/tmp/hb')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const [readApi, readSrv] = parsed.workspaces
    expect(readApi.directory).toBe('/tmp/hb/proj')
    expect(readApi.cards[0]).toEqual({
      ...api.cards[0],
      directory: '/tmp/hb/proj',
      claudeStarted: false
    })
    expect(readSrv).toEqual(srv)
  })

  it('reads a local card the file marks as started as not started (D6)', () => {
    const text = fileWith((f) => {
      const board = f.board as { workspaces: { cards: { claudeStarted: boolean }[] }[] }
      board.workspaces[0].cards[0].claudeStarted = true
    })
    const parsed = parseSyncFile(text, HOME)
    expect(parsed.ok && parsed.workspaces[0].cards[0].claudeStarted).toBe(false)
  })

  it("reads a local card's startedAgents as empty and an SSH card's as written (#21 D7)", () => {
    const text = fileWith((f) => {
      const board = f.board as { workspaces: { cards: { startedAgents: string[] }[] }[] }
      board.workspaces[0].cards[0].startedAgents = ['codex']
      board.workspaces[1].cards[0].startedAgents = ['opencode']
    })
    const parsed = parseSyncFile(text, HOME)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.workspaces.map((w) => w.cards[0].startedAgents)).toEqual([[], ['opencode']])
  })

  it('reads a file without startedAgents as empty (#21 D7)', () => {
    const text = fileWith((f) => {
      const board = f.board as { workspaces: { cards: Record<string, unknown>[] }[] }
      for (const w of board.workspaces) for (const c of w.cards) delete c.startedAgents
    })
    const parsed = parseSyncFile(text, HOME)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.workspaces.map((w) => w.cards[0].startedAgents)).toEqual([[], []])
  })

  it('reads an empty board', () => {
    const parsed = parseSyncFile(
      '{"version":1,"savedAt":"2026-10-14T09:05:00.000Z","board":{"workspaces":[]}}',
      HOME
    )
    expect(parsed).toEqual({ ok: true, workspaces: [] })
  })

  it.each<[string, string]>([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['another version', fileWith((f) => (f.version = 2))],
    ['no savedAt', fileWith((f) => delete f.savedAt)],
    ['a savedAt that is no date', fileWith((f) => (f.savedAt = 'yesterday'))],
    ['no board', fileWith((f) => delete f.board)],
    ['a board without workspaces', fileWith((f) => (f.board = {}))],
    [
      'a duplicate id',
      fileWith((f) => {
        const board = f.board as { workspaces: { id: string }[] }
        board.workspaces[1].id = board.workspaces[0].id
      })
    ],
    [
      'a card in an unknown column',
      fileWith((f) => {
        const board = f.board as { workspaces: { cards: { columnId: string }[] }[] }
        board.workspaces[0].cards[0].columnId = 'nope'
      })
    ]
  ])('rejects a file with %s as unreadable', (_, text) => {
    expect(parseSyncFile(text, HOME).ok).toBe(false)
  })
})

describe('joining the boards when sync is turned on (#13 D9, AC3)', () => {
  it("takes the file's workspaces in order, then this machine's the file lacks, in order", () => {
    const fileApi = workspace('api', 'api')
    const fileDocs = workspace('docs', 'docs')
    const localWeb = workspace('web', 'web')
    const localOps = workspace('ops', 'ops')
    expect(joinBoards([fileApi, fileDocs], [localWeb, localOps]).map((w) => w.id)).toEqual([
      'api',
      'docs',
      'web',
      'ops'
    ])
  })

  it('takes a workspace both have from the file', () => {
    const fileApi = workspace('api', 'api renamed')
    const localApi = workspace('api', 'api', { cards: [card('c1', 'api-backlog')] })
    const localWeb = workspace('web', 'web')
    expect(joinBoards([fileApi], [localWeb, localApi])).toEqual([fileApi, localWeb])
  })

  it("is this machine's board when the file's is empty", () => {
    const localWeb = workspace('web', 'web')
    expect(joinBoards([], [localWeb])).toEqual([localWeb])
  })
})

describe('worktree cards in the sync file', () => {
  it('writes the worktree with home as ~ and reads it back expanded', () => {
    const worktree = { path: `${HOME}/wt/fix`, branch: 'drovr/fix', repo: `${HOME}/proj` }
    const state: WorkspaceState = {
      activeId: 'w',
      workspaces: [
        workspace('w', 'alpha', {
          cards: [card('k', 'w-backlog', { directory: `${HOME}/wt/fix`, worktree })]
        })
      ]
    }
    const board = toSyncBoard(state, HOME)
    expect(board.workspaces[0]!.cards[0]!.worktree).toEqual({
      path: '~/wt/fix',
      branch: 'drovr/fix',
      repo: '~/proj'
    })
    const read = parseSyncFile(serializeSyncFile(board, new Date(0)), HOME)
    expect(read.ok && read.workspaces[0]!.cards[0]!.worktree).toEqual(worktree)
  })
})

describe('worktree setup in the sync file (#39 D1, AC12)', () => {
  it('writes the workspace setup and reads it back on the other machine', () => {
    const state: WorkspaceState = {
      activeId: 'w',
      workspaces: [workspace('w', 'alpha', { worktreeSetup: 'npm ci' })]
    }
    const board = toSyncBoard(state, HOME)
    expect(board.workspaces[0]!.worktreeSetup).toBe('npm ci')
    const read = parseSyncFile(serializeSyncFile(board, new Date(0)), '/tmp/hb')
    expect(read.ok && read.workspaces[0]!.worktreeSetup).toBe('npm ci')
  })
})

describe("a card's pending setup is not synced (#39 D8, AC12)", () => {
  it('writes no setup on any card, and reads a card the file gives one as having none', () => {
    const state: WorkspaceState = {
      activeId: 'w',
      workspaces: [
        workspace('w', 'alpha', {
          worktreeSetup: 'npm ci',
          cards: [card('k', 'w-backlog', { setup: 'npm ci' })]
        })
      ]
    }
    const board = toSyncBoard(state, HOME)
    expect(board.workspaces[0]!.cards[0]).not.toHaveProperty('setup')
    const file = JSON.parse(serializeSyncFile(board, new Date(0)))
    file.board.workspaces[0].cards[0].setup = 'npm ci'
    const read = parseSyncFile(JSON.stringify(file), HOME)
    expect(read.ok && read.workspaces[0]!.cards[0]).not.toHaveProperty('setup')
  })
})

describe('workspace logos in the sync file (#59 D6, AC6)', () => {
  it('writes the logo, absent for none, and reads it back on the other machine', () => {
    const state: WorkspaceState = {
      activeId: 'w',
      workspaces: [workspace('w', 'alpha', { logo: 'rocket' }), workspace('v', 'beta')]
    }
    const board = toSyncBoard(state, HOME)
    expect(board.workspaces[0]!.logo).toBe('rocket')
    expect(board.workspaces[1]!).not.toHaveProperty('logo')
    const file = JSON.parse(serializeSyncFile(board, new Date(0)))
    expect(file.board.workspaces[0].logo).toBe('rocket')
    expect(file.board.workspaces[1]).not.toHaveProperty('logo')
    const read = parseSyncFile(serializeSyncFile(board, new Date(0)), '/tmp/hb')
    expect(read.ok && read.workspaces[0]!.logo).toBe('rocket')
    expect(read.ok && read.workspaces[1]!).not.toHaveProperty('logo')
  })
})

describe('automatic move rules in the sync file (#42 D7, AC11)', () => {
  it('writes autoMove, absent with every rule off, and reads it back on the other machine', () => {
    const rules = { waiting: 'w-running', stopped: 'w-backlog' }
    const state: WorkspaceState = {
      activeId: 'w',
      workspaces: [workspace('w', 'alpha', { autoMove: rules }), workspace('v', 'beta')]
    }
    const board = toSyncBoard(state, HOME)
    expect(board.workspaces[0]!.autoMove).toEqual(rules)
    expect(board.workspaces[0]!.autoMove).not.toBe(rules)
    expect(board.workspaces[1]!).not.toHaveProperty('autoMove')
    const text = serializeSyncFile(board, new Date(0))
    expect(JSON.parse(text).board.workspaces[1]).not.toHaveProperty('autoMove')
    const read = parseSyncFile(text, '/tmp/hb')
    expect(read.ok && read.workspaces[0]!.autoMove).toEqual(rules)
    expect(read.ok && read.workspaces[1]!).not.toHaveProperty('autoMove')
  })

  it('reads a rule naming an unknown column as off, and rejects a bad autoMove', () => {
    const fileWith = (autoMove: unknown): string =>
      JSON.stringify({
        version: 1,
        savedAt: new Date(0).toISOString(),
        board: { workspaces: [{ ...workspace('w', 'alpha'), autoMove }] }
      })
    const read = parseSyncFile(fileWith({ working: 'gone', waiting: 'w-running' }), HOME)
    expect(read.ok && read.workspaces[0]!.autoMove).toEqual({ waiting: 'w-running' })
    const gone = parseSyncFile(fileWith({ stopped: 'gone' }), HOME)
    expect(gone.ok && gone.workspaces[0]!).not.toHaveProperty('autoMove')
    expect(parseSyncFile(fileWith(5), HOME).ok).toBe(false)
    expect(parseSyncFile(fileWith({ waiting: 5 }), HOME).ok).toBe(false)
  })
})
