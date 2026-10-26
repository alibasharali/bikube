import { describe, expect, it } from 'vitest'
import { InMemoryWorkspaceStore, type Result, type WorkspaceState } from './workspace-store'
import {
  STATE_FILE_NAME,
  corruptFileName,
  parseSavedState,
  serializeSavedState,
  validateWorkspaceState
} from './saved-state'

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.message}`)
  return r.value
}

/** Two workspaces, renamed/reordered/deleted columns, cards of every startup kind. */
function fullState(): WorkspaceState {
  let n = 0
  const s = new InMemoryWorkspaceStore({
    generateId: () => `id-${++n}`,
    generateSessionId: () => `00000000-0000-4000-8000-00000000000${n}`
  })
  const alpha = ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/bikube-alpha' }))
  const beta = ok(
    s.createWorkspace({
      name: 'beta',
      directory: '/tmp/bikube-beta',
      defaultStartup: { kind: 'claude' }
    })
  )
  const [backlog, running, needsMe] = alpha.columns
  ok(s.renameColumn(alpha.id, backlog.id, 'Todo'))
  ok(s.renameColumn(alpha.id, running.id, 'Doing'))
  ok(s.deleteColumn(alpha.id, needsMe.id))
  const api = ok(s.createCard(alpha.id, running.id, 'api'))
  const web = ok(s.createCard(alpha.id, backlog.id, ''))
  ok(s.createCard(alpha.id, backlog.id, 'db', { kind: 'custom', command: 'npm run dev' }))
  ok(s.moveCard(alpha.id, web.id, running.id, 1))
  ok(s.renameCard(alpha.id, api.id, 'server'))
  ok(
    s.updateWorkspace(alpha.id, {
      directory: '/tmp/bikube-beta',
      defaultStartup: { kind: 'claude' }
    })
  )
  const agent = ok(s.createCard(beta.id, beta.columns[0].id, 'agent'))
  ok(s.markClaudeStarted(beta.id, agent.id))
  ok(s.selectWorkspace(beta.id))
  return s.getState()
}

describe('saved-state round trip (#8 D1, D2)', () => {
  it('serialises to version 1 and parses back to an equal state', () => {
    const state = fullState()
    const text = serializeSavedState(state)
    expect(JSON.parse(text)).toEqual({ version: 1, state })
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })
})

/** The file contents for `fullState()` after `change` edits a parsed copy of its state. */
// The edits deliberately break the types, so the copy is untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fileWith(change: (state: any) => void): string {
  const state = JSON.parse(JSON.stringify(fullState()))
  change(state)
  return JSON.stringify({ version: 1, state })
}

function expectRejected(text: string): void {
  const result = parseSavedState(text)
  expect(result.ok).toBe(false)
}

describe('saved-state rejection (#8 D3)', () => {
  it('rejects text that is not JSON', () => {
    expectRejected('{not json')
    expectRejected('')
  })

  it('rejects another version or a missing state', () => {
    expectRejected('{"version": 2, "state": {}}')
    expectRejected(JSON.stringify({ version: 2, state: fullState() }))
    expectRejected(JSON.stringify({ state: fullState() }))
    expectRejected('{"version": 1}')
    expectRejected('[1]')
    expectRejected('null')
  })

  it('rejects a missing or mistyped field', () => {
    expectRejected(fileWith((s) => delete s.activeId))
    expectRejected(fileWith((s) => delete s.workspaces))
    expectRejected(fileWith((s) => delete s.workspaces[0].name))
    expectRejected(fileWith((s) => delete s.workspaces[0].directory))
    expectRejected(fileWith((s) => delete s.workspaces[0].nextCardNumber))
    expectRejected(fileWith((s) => delete s.workspaces[0].defaultStartup))
    expectRejected(fileWith((s) => (s.workspaces[0].columns = {})))
    expectRejected(fileWith((s) => delete s.workspaces[0].columns[0].name))
    expectRejected(fileWith((s) => delete s.workspaces[0].cards[0].title))
    expectRejected(fileWith((s) => delete s.workspaces[0].cards[0].directory))
    expectRejected(fileWith((s) => delete s.workspaces[0].cards[0].agentSessionId))
    expectRejected(fileWith((s) => delete s.workspaces[0].cards[0].claudeStarted))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].claudeStarted = 'yes')))
    expectRejected(fileWith((s) => (s.workspaces[0].nextCardNumber = '2')))
    expectRejected(fileWith((s) => (s.workspaces[0].nextCardNumber = 0)))
    expectRejected(fileWith((s) => (s.workspaces[0].nextCardNumber = 1.5)))
    expectRejected(fileWith((s) => (s.workspaces[0].id = 7)))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0] = null)))
  })

  it('rejects a startup command that fails checkStartup', () => {
    expectRejected(fileWith((s) => (s.workspaces[0].defaultStartup = { kind: 'bash' })))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].startup = { kind: 'custom' })))
    expectRejected(
      fileWith((s) => (s.workspaces[0].cards[0].startup = { kind: 'custom', command: '  ' }))
    )
    expectRejected(
      fileWith((s) => (s.workspaces[0].cards[0].startup = { kind: 'custom', command: 'a\nb' }))
    )
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].startup = 'shell')))
  })

  it('rejects a card in a column its workspace does not have', () => {
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].columnId = 'nope')))
    // A column of the other workspace is still unknown to this one.
    expectRejected(
      fileWith((s) => (s.workspaces[0].cards[0].columnId = s.workspaces[1].columns[0].id))
    )
  })

  it('rejects a duplicate id among workspaces, columns and cards together', () => {
    expectRejected(fileWith((s) => (s.workspaces[1].id = s.workspaces[0].id)))
    expectRejected(fileWith((s) => (s.workspaces[0].columns[1].id = s.workspaces[0].columns[0].id)))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[1].id = s.workspaces[0].cards[0].id)))
    expectRejected(fileWith((s) => (s.workspaces[1].cards[0].id = s.workspaces[0].cards[0].id)))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].id = s.workspaces[1].id)))
  })

  it('rejects an activeId that names no workspace', () => {
    expectRejected(fileWith((s) => (s.activeId = 'nope')))
    // A column id is not a workspace id.
    expectRejected(fileWith((s) => (s.activeId = s.workspaces[0].columns[0].id)))
  })

  it('rejects activeId null while there are workspaces', () => {
    expectRejected(fileWith((s) => (s.activeId = null)))
  })

  it('rejects a non-null activeId with no workspaces, and accepts the empty state', () => {
    expectRejected(JSON.stringify({ version: 1, state: { workspaces: [], activeId: 'x' } }))
    const empty = { workspaces: [], activeId: null }
    expect(parseSavedState(serializeSavedState(empty))).toEqual({ ok: true, value: empty })
  })
})

describe('validateWorkspaceState (#8 D3, D6)', () => {
  it('accepts a parsed state and keeps only the fields of D1', () => {
    const state = fullState()
    const extra = {
      ...state,
      workspaces: [{ ...state.workspaces[0], status: 'x' }, state.workspaces[1]]
    }
    expect(validateWorkspaceState(extra)).toEqual({ ok: true, value: state })
  })

  it('rejects anything that is not a state', () => {
    expect(validateWorkspaceState(undefined).ok).toBe(false)
    expect(validateWorkspaceState('{}').ok).toBe(false)
    expect(validateWorkspaceState({ workspaces: [] }).ok).toBe(false)
  })
})

describe('file names (#8 D2, D4)', () => {
  it('names the state file and the corrupt copy by UTC timestamp', () => {
    expect(STATE_FILE_NAME).toBe('bikube-state.json')
    expect(corruptFileName(new Date(Date.UTC(2026, 9, 13, 14, 15, 0, 123)))).toBe(
      'bikube-state.corrupt-20261013T141500Z.json'
    )
  })
})

describe('SSH hosts in the saved state (#12 D10)', () => {
  /** `fullState()` plus SSH workspace `remote` with a card made while it was on `me@devbox`. */
  function sshState(): WorkspaceState {
    let n = 100
    const s = new InMemoryWorkspaceStore({
      initialState: fullState(),
      generateId: () => `id-${++n}`,
      generateSessionId: () => '00000000-0000-4000-8000-000000000100'
    })
    const remote = ok(s.createWorkspace({ name: 'remote', directory: '~/api', host: 'me@devbox' }))
    ok(s.createCard(remote.id, remote.columns[0].id, 'a'))
    ok(s.updateWorkspace(remote.id, { host: 'other' }))
    return s.getState()
  }

  /** The file contents for `sshState()` after `change` edits a parsed copy of its state. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sshFileWith(change: (state: any) => void): string {
    const state = JSON.parse(JSON.stringify(sshState()))
    change(state)
    return JSON.stringify({ version: 1, state })
  }

  it('writes host only on SSH workspaces and cards, and reads it back', () => {
    const state = sshState()
    const text = serializeSavedState(state)
    const file = JSON.parse(text)
    expect(file.version).toBe(1)
    const [alpha, beta, remote] = file.state.workspaces
    expect(remote.host).toBe('other')
    expect(remote.cards[0].host).toBe('me@devbox')
    for (const ws of [alpha, beta]) {
      expect('host' in ws).toBe(false)
      for (const card of ws.cards) expect('host' in card).toBe(false)
    }
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })

  it('loads a file without any host, or with host null, as local', () => {
    const old = parseSavedState(serializeSavedState(fullState()))
    expect(old).toEqual({ ok: true, value: fullState() })
    const nulls = parseSavedState(
      fileWith((s) => {
        s.workspaces[0].host = null
        s.workspaces[0].cards[0].host = null
      })
    )
    expect(nulls).toEqual({ ok: true, value: fullState() })
    if (!nulls.ok) return
    expect('host' in nulls.value.workspaces[0]).toBe(false)
    expect('host' in nulls.value.workspaces[0].cards[0]).toBe(false)
  })

  it('rejects a host failing D2 on a workspace or a card', () => {
    expectRejected(sshFileWith((s) => (s.workspaces[2].cards[0].host = '-x')))
    expectRejected(sshFileWith((s) => (s.workspaces[2].host = '-oProxyCommand=x')))
    expectRejected(sshFileWith((s) => (s.workspaces[2].host = '')))
    expectRejected(sshFileWith((s) => (s.workspaces[2].host = 7)))
    expectRejected(fileWith((s) => (s.workspaces[0].cards[0].host = 'me@dev box')))
  })

  it('rejects an SSH workspace or card whose directory fails D3', () => {
    expectRejected(sshFileWith((s) => (s.workspaces[2].directory = 'relative/dir')))
    expectRejected(sshFileWith((s) => (s.workspaces[2].cards[0].directory = '~other')))
  })
})

describe('agent presets in the saved state (#21 D6)', () => {
  /** `fullState()` plus workspace `presets` defaulting to Codex, with a started Codex card. */
  function presetState(): WorkspaceState {
    let n = 200
    const s = new InMemoryWorkspaceStore({
      initialState: fullState(),
      generateId: () => `id-${++n}`,
      generateSessionId: () => '00000000-0000-4000-8000-000000000200'
    })
    const w = ok(
      s.createWorkspace({ name: 'presets', directory: '/tmp/p', defaultStartup: { kind: 'codex' } })
    )
    const cx = ok(s.createCard(w.id, w.columns[0].id, 'cx'))
    ok(s.markAgentStarted(w.id, cx.id, 'codex'))
    ok(s.createCard(w.id, w.columns[0].id, 'gm', { kind: 'gemini' }))
    ok(s.createCard(w.id, w.columns[0].id, 'oc', { kind: 'opencode' }))
    const pi = ok(s.createCard(w.id, w.columns[0].id, 'pi', { kind: 'pi' }))
    ok(s.markAgentStarted(w.id, pi.id, 'pi'))
    return s.getState()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function presetFileWith(change: (state: any) => void): string {
    const state = JSON.parse(JSON.stringify(presetState()))
    change(state)
    return JSON.stringify({ version: 1, state })
  }

  it('writes the preset kinds and startedAgents on every card, and reads them back (AC7)', () => {
    const state = presetState()
    const text = serializeSavedState(state)
    const presets = JSON.parse(text).state.workspaces[2]
    expect(presets.defaultStartup).toEqual({ kind: 'codex' })
    expect(presets.cards.map((c: { startup: unknown }) => c.startup)).toEqual([
      { kind: 'codex' },
      { kind: 'gemini' },
      { kind: 'opencode' },
      { kind: 'pi' }
    ])
    expect(presets.cards[0].startedAgents).toEqual(['codex'])
    expect(presets.cards[3].startedAgents).toEqual(['pi'])
    expect(JSON.parse(text).state.workspaces[0].cards[0].startedAgents).toEqual([])
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })

  it('reads a card without startedAgents, as written before #21, as none started (AC7)', () => {
    const old = parseSavedState(
      fileWith((s) => {
        for (const w of s.workspaces) for (const c of w.cards) delete c.startedAgents
      })
    )
    expect(old).toEqual({ ok: true, value: fullState() })
  })

  it('rejects an unknown kind, a non-array or repeated startedAgents', () => {
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[0].startedAgents = ['cursor'])))
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[0].startedAgents = ['claude'])))
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[0].startedAgents = 'codex')))
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[0].startedAgents = null)))
    expectRejected(
      presetFileWith((s) => (s.workspaces[2].cards[0].startedAgents = ['codex', 'codex']))
    )
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[0].startup = { kind: 'amp' })))
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[3].startup = { kind: 'pie' })))
    expectRejected(presetFileWith((s) => (s.workspaces[2].cards[3].startedAgents = ['pie'])))
  })
})

describe('saved worktree cards', () => {
  const state = (cardOver: Record<string, unknown>): string =>
    JSON.stringify({
      version: 1,
      state: {
        activeId: 'w',
        workspaces: [
          {
            id: 'w',
            name: 'alpha',
            directory: '/tmp/repo',
            columns: [{ id: 'c', name: 'Backlog' }],
            cards: [
              {
                id: 'k',
                columnId: 'c',
                title: 'fix',
                directory: '/data/wt/fix',
                startup: { kind: 'claude' },
                agentSessionId: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11',
                claudeStarted: false,
                startedAgents: [],
                ...cardOver
              }
            ],
            nextCardNumber: 1,
            defaultStartup: { kind: 'shell' }
          }
        ]
      }
    })
  const worktree = { path: '/data/wt/fix', branch: 'bikube/fix', repo: '/tmp/repo' }

  it('keeps a valid worktree, and reads a card without one as before', () => {
    const parsed = parseSavedState(state({ worktree }))
    expect(parsed.ok && parsed.value.workspaces[0]!.cards[0]!.worktree).toEqual(worktree)
    const plain = parseSavedState(state({}))
    expect(plain.ok && plain.value.workspaces[0]!.cards[0]).not.toHaveProperty('worktree')
  })

  it('rejects a bad worktree, and one on an SSH card', () => {
    expect(parseSavedState(state({ worktree: { path: '/x' } })).ok).toBe(false)
    expect(parseSavedState(state({ worktree, host: 'devbox', directory: '~/api' })).ok).toBe(false)
  })

  it("keeps a card's pending setup, reads a card without one as none (#39 D8)", () => {
    const parsed = parseSavedState(state({ worktree, setup: 'npm ci' }))
    expect(parsed.ok && parsed.value.workspaces[0]!.cards[0]!.setup).toBe('npm ci')
    const round = parsed.ok && parseSavedState(serializeSavedState(parsed.value))
    expect(round && round.ok && round.value.workspaces[0]!.cards[0]!.setup).toBe('npm ci')
    const none = parseSavedState(state({ worktree }))
    expect(none.ok && none.value.workspaces[0]!.cards[0]).not.toHaveProperty('setup')
  })

  it('rejects a pending setup that is not one trimmed, non-empty line', () => {
    for (const setup of ['a\nb', ' npm ci', '', 3]) {
      expect(parseSavedState(state({ worktree, setup })).ok).toBe(false)
    }
  })
})

describe('shells, and a workspace defaulting to Shell', () => {
  const file = (workspace: Record<string, unknown>): string =>
    JSON.stringify({
      version: 1,
      state: {
        activeId: 'w',
        workspaces: [
          {
            id: 'w',
            name: 'alpha',
            directory: '/tmp/repo',
            columns: [{ id: 'c', name: 'Backlog' }],
            cards: [],
            nextCardNumber: 1,
            defaultStartup: { kind: 'shell' },
            ...workspace
          }
        ]
      }
    })
  const card = (id: string, title: string, kind: string): object => ({
    id,
    columnId: 'c',
    title,
    directory: '/tmp/repo',
    startup: { kind },
    agentSessionId: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11',
    claudeStarted: false,
    startedAgents: []
  })

  it('keeps every card, adds no shells, and defaults new cards to Claude Code', () => {
    const parsed = parseSavedState(
      file({ cards: [card('k1', 'Scratch', 'shell'), card('k2', 'Fix login', 'claude')] })
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    const [w] = parsed.value.workspaces
    expect(w!.cards.map((c) => c.title)).toEqual(['Scratch', 'Fix login'])
    expect(w!.shells).toEqual([])
    expect(w!.defaultStartup).toEqual({ kind: 'claude' })
  })

  it('reads saved shells, and rejects a bad one', () => {
    const shells = [
      {
        id: 's1',
        name: 'Dev server',
        command: 'npm run dev',
        autostart: true,
        type: 'trigger'
      }
    ]
    const parsed = parseSavedState(file({ shells }))
    expect(parsed.ok && parsed.value.workspaces[0]!.shells).toEqual(shells)
    // A file from before Auto close and Start in the background: both off.
    const older = parseSavedState(
      file({ shells: [{ id: 's1', name: 'Dev server', command: 'npm run dev', autostart: true }] })
    )
    expect(older.ok && older.value.workspaces[0]!.shells[0]!.type).toBe('shell')
    // Before types: Close when the command stops or Start in the background, with a command,
    // made a trigger; without a command it stays a shell.
    const typeOf = (s: Record<string, unknown>): unknown => {
      const read = parseSavedState(
        file({ shells: [{ id: 's1', name: 'Dev', autostart: false, ...s }] })
      )
      return read.ok && read.value.workspaces[0]!.shells[0]!.type
    }
    expect(typeOf({ command: 'npm run dev', autoClose: true })).toBe('trigger')
    expect(typeOf({ command: 'npm run dev', background: true })).toBe('trigger')
    expect(typeOf({ command: '', background: true })).toBe('shell')
    expect(parseSavedState(file({ shells: [{ id: 's1', name: '' }] })).ok).toBe(false)
    expect(parseSavedState(file({ shells: 'nope' })).ok).toBe(false)
  })
})

describe('worktree setup in the saved state (#39 D1)', () => {
  it('round trips, reads a file without it as none, and rejects a bad one', () => {
    const s = new InMemoryWorkspaceStore()
    ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/a', worktreeSetup: 'npm ci' }))
    const text = serializeSavedState(s.getState())
    const parsed = parseSavedState(text)
    expect(parsed.ok && parsed.value.workspaces[0]!.worktreeSetup).toBe('npm ci')
    const without = parseSavedState(
      fileWith((state) => {
        for (const w of state.workspaces) delete w.worktreeSetup
      })
    )
    expect(without.ok && without.value.workspaces.map((w) => w.worktreeSetup)).toEqual(['', ''])
    expectRejected(fileWith((state) => (state.workspaces[0].worktreeSetup = 'a\nb')))
    expectRejected(fileWith((state) => (state.workspaces[0].worktreeSetup = 3)))
    expectRejected(fileWith((state) => (state.workspaces[0].worktreeSetup = 'npm ci;')))
  })
})

describe('workspace logos in the saved state (#59 D2, D5, AC4)', () => {
  it('writes a logo only on a workspace that has one, and reads it back', () => {
    const s = new InMemoryWorkspaceStore({ initialState: fullState() })
    const [alpha] = s.getState().workspaces
    ok(s.updateWorkspace(alpha.id, { logo: 'rocket' }))
    const state = s.getState()
    const text = serializeSavedState(state)
    const [first, second] = JSON.parse(text).state.workspaces
    expect(first.logo).toBe('rocket')
    expect('logo' in second).toBe(false)
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })

  it('reads a file from before logos with none', () => {
    const read = parseSavedState(serializeSavedState(fullState()))
    expect(read.ok && read.value.workspaces.every((w) => !('logo' in w))).toBe(true)
  })

  it('reads an unknown logo as none and loads the rest of the file', () => {
    const read = parseSavedState(fileWith((s) => (s.workspaces[0].logo = 'not-a-logo')))
    expect(read).toEqual({ ok: true, value: fullState() })
    expect(read.ok && 'logo' in read.value.workspaces[0]).toBe(false)
  })

  it('rejects a logo that is not a string', () => {
    expectRejected(fileWith((s) => (s.workspaces[0].logo = 5)))
    expectRejected(fileWith((s) => (s.workspaces[0].logo = null)))
  })
})

describe('workspace views and card open times in the saved state', () => {
  it('writes view only for a Grid workspace and lastOpenedAt only on a card with one', () => {
    const s = new InMemoryWorkspaceStore({ initialState: fullState() })
    const [alpha] = s.getState().workspaces
    ok(s.updateWorkspace(alpha.id, { view: 'grid' }))
    ok(s.markCardOpened(alpha.id, alpha.cards[0].id, 1_700_000_000_000))
    s.replaceBoard(
      s
        .getState()
        .workspaces.map((w, i) =>
          i === 0
            ? { ...w, cards: w.cards.map((c, j) => (j === 1 ? { ...c, createdAt: 5 } : c)) }
            : w
        )
    )
    const state = s.getState()
    const text = serializeSavedState(state)
    const [first, second] = JSON.parse(text).state.workspaces
    expect(first.view).toBe('grid')
    expect('view' in second).toBe(false)
    expect(first.cards[0].lastOpenedAt).toBe(1_700_000_000_000)
    expect(first.cards[1].createdAt).toBe(5)
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })

  it('reads an unknown view as Kanban and drops a bad open time, loading the rest', () => {
    const read = parseSavedState(
      fileWith((s) => {
        s.workspaces[0].view = 'timeline'
        s.workspaces[0].cards[0].lastOpenedAt = 'yesterday'
        s.workspaces[0].cards[0].createdAt = -1
      })
    )
    expect(read).toEqual({ ok: true, value: fullState() })
  })

  it('keeps a Kanban view of its own, as written', () => {
    const s = new InMemoryWorkspaceStore({ initialState: fullState() })
    ok(s.updateWorkspace(s.getState().workspaces[0].id, { view: 'kanban' }))
    const text = serializeSavedState(s.getState())
    expect(JSON.parse(text).state.workspaces[0].view).toBe('kanban')
    expect(parseSavedState(text)).toEqual({ ok: true, value: s.getState() })
  })

  it('rejects a view that is not a string', () => {
    expectRejected(fileWith((s) => (s.workspaces[0].view = 1)))
  })
})

describe('automatic move rules in the saved state (#42 D2, D7, AC10)', () => {
  it('writes autoMove only on a workspace with a rule on, and reads it back', () => {
    const s = new InMemoryWorkspaceStore({ initialState: fullState() })
    const [alpha] = s.getState().workspaces
    ok(s.updateWorkspace(alpha.id, { autoMove: { waiting: alpha.columns[1].id } }))
    const state = s.getState()
    const text = serializeSavedState(state)
    const [first, second] = JSON.parse(text).state.workspaces
    expect(first.autoMove).toEqual({ waiting: alpha.columns[1].id })
    expect('autoMove' in second).toBe(false)
    expect(parseSavedState(text)).toEqual({ ok: true, value: state })
  })

  it('reads a file without autoMove with every rule off', () => {
    const read = parseSavedState(serializeSavedState(fullState()))
    expect(read.ok && read.value.workspaces.every((w) => !('autoMove' in w))).toBe(true)
  })

  it('reads a rule naming an unknown column as off, ignores unknown keys, and loads the rest', () => {
    const read = parseSavedState(
      fileWith((s) => {
        const w = s.workspaces[0]
        w.autoMove = { working: 'gone', waiting: w.columns[0].id, later: 'x' }
        s.workspaces[1].autoMove = { stopped: 'gone' }
      })
    )
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const [first, second] = read.value.workspaces
    expect(first.autoMove).toEqual({ waiting: first.columns[0].id })
    expect('autoMove' in second).toBe(false)
  })

  it('rejects an autoMove that is not an object, or a rule that is not a string', () => {
    expectRejected(fileWith((s) => (s.workspaces[0].autoMove = 5)))
    expectRejected(fileWith((s) => (s.workspaces[0].autoMove = null)))
    expectRejected(fileWith((s) => (s.workspaces[0].autoMove = ['x'])))
    expectRejected(fileWith((s) => (s.workspaces[0].autoMove = { waiting: 5 })))
    expectRejected(fileWith((s) => (s.workspaces[0].autoMove = { stopped: null })))
  })
})

describe('temporary shells are never saved (#66 D2, AC4)', () => {
  it('drops them from a state to save and from a file that names one', () => {
    const s = new InMemoryWorkspaceStore()
    const w = ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/bikube-alpha' }))
    const named = ok(s.createShell(w.id, { name: 'Dev', command: '', autostart: false }))
    ok(s.createTemporaryShell(w.id))
    const checked = validateWorkspaceState(s.getState())
    expect(checked.ok && checked.value.workspaces[0]!.shells).toEqual([named])
    const file = JSON.stringify({ version: 1, state: s.getState() })
    const parsed = parseSavedState(file)
    expect(parsed.ok && parsed.value.workspaces[0]!.shells).toEqual([named])
  })
})
