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
  const alpha = ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/drovr-alpha' }))
  const beta = ok(
    s.createWorkspace({
      name: 'beta',
      directory: '/tmp/drovr-beta',
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
      directory: '/tmp/drovr-beta',
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
    expect(STATE_FILE_NAME).toBe('drovr-state.json')
    expect(corruptFileName(new Date(Date.UTC(2026, 9, 13, 14, 15, 0, 123)))).toBe(
      'drovr-state.corrupt-20261013T141500Z.json'
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
      { kind: 'opencode' }
    ])
    expect(presets.cards[0].startedAgents).toEqual(['codex'])
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
  })
})
