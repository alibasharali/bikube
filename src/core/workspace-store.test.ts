import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COLUMN_NAMES,
  InMemoryWorkspaceStore,
  basename,
  cardsInColumn,
  workspaceView,
  workspaceViewChoice,
  type Card,
  type Column,
  type Result,
  type Workspace
} from './workspace-store'

function make(validateDirectory?: (d: string) => string | null): InMemoryWorkspaceStore {
  return new InMemoryWorkspaceStore({ validateDirectory })
}

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.field}: ${r.error.message}`)
  return r.value
}

function names(w: Workspace): string[] {
  return w.columns.map((c) => c.name)
}

function create(
  s: InMemoryWorkspaceStore,
  name: string,
  directory = `/tmp/${name || 'x'}`
): Workspace {
  return ok(s.createWorkspace({ name, directory }))
}

describe('basename', () => {
  it('returns the last path segment', () => {
    expect(basename('/tmp/alpha')).toBe('alpha')
    expect(basename('/tmp/alpha/')).toBe('alpha')
    expect(basename('C:\\work\\beta\\')).toBe('beta')
    expect(basename('/')).toBe('')
  })
})

describe('create workspace (AC2)', () => {
  it('defaults the name to the folder basename when empty', () => {
    const s = make()
    const w = create(s, '', '/tmp/alpha')
    expect(w.name).toBe('alpha')
    expect(w.directory).toBe('/tmp/alpha')
  })

  it('starts with the default columns in order', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(names(w)).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
    expect(DEFAULT_COLUMN_NAMES).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
  })

  it('makes the first workspace active and leaves it active when more are added', () => {
    const s = make()
    const a = create(s, 'alpha')
    expect(s.getState().activeId).toBe(a.id)
    create(s, 'beta')
    expect(s.getState().activeId).toBe(a.id)
    expect(s.getState().workspaces.map((w) => w.name)).toEqual(['alpha', 'beta'])
  })

  it('gives each workspace its own board and a unique id', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    expect(a.id).not.toBe(b.id)
    expect(a.columns[0].id).not.toBe(b.columns[0].id)
  })

  it('trims the name and directory', () => {
    const s = make()
    const w = create(s, '  alpha  ', ' /tmp/alpha ')
    expect(w.name).toBe('alpha')
    expect(w.directory).toBe('/tmp/alpha')
  })
})

describe('validation (AC3)', () => {
  it('rejects a duplicate name case-insensitively and creates nothing', () => {
    const s = make()
    create(s, 'alpha')
    const r = s.createWorkspace({ name: 'Alpha', directory: '/tmp/other' })
    expect(r).toMatchObject({ ok: false, error: { field: 'name' } })
    expect(s.getState().workspaces).toHaveLength(1)
  })

  it('rejects an empty or whitespace name when no basename can be derived', () => {
    const s = make()
    for (const name of ['', '   ']) {
      const r = s.createWorkspace({ name, directory: '/' })
      expect(r).toMatchObject({ ok: false, error: { field: 'name' } })
    }
    expect(s.getState().workspaces).toHaveLength(0)
  })

  it('rejects a relative or empty directory', () => {
    const s = make()
    expect(s.createWorkspace({ name: 'a', directory: 'rel/dir' })).toMatchObject({
      ok: false,
      error: { field: 'directory' }
    })
    expect(s.createWorkspace({ name: 'a', directory: '  ' })).toMatchObject({
      ok: false,
      error: { field: 'directory' }
    })
  })

  it('uses the injected directory validator and reports its message', () => {
    const validate = vi.fn((d: string) => (d === '/tmp/missing' ? 'Not a directory' : null))
    const s = make(validate)
    const r = s.createWorkspace({ name: 'a', directory: '/tmp/missing' })
    expect(r).toEqual({ ok: false, error: { field: 'directory', message: 'Not a directory' } })
    expect(s.getState().workspaces).toHaveLength(0)
    expect(s.createWorkspace({ name: 'a', directory: '/tmp/ok' }).ok).toBe(true)
  })
})

describe('update workspace (AC5)', () => {
  it('renames and changes the directory', () => {
    const s = make()
    const a = create(s, 'alpha')
    const w = ok(s.updateWorkspace(a.id, { name: 'gamma', directory: '/tmp/gamma' }))
    expect(w).toMatchObject({ id: a.id, name: 'gamma', directory: '/tmp/gamma' })
    expect(s.getState().workspaces[0].name).toBe('gamma')
  })

  it('keeps the board when editing', () => {
    const s = make()
    const a = create(s, 'alpha')
    ok(s.addColumn(a.id, 'QA'))
    ok(s.updateWorkspace(a.id, { name: 'gamma' }))
    expect(names(s.getState().workspaces[0])).toContain('QA')
  })

  it('rejects a duplicate name but allows keeping or re-casing its own', () => {
    const s = make()
    const a = create(s, 'alpha')
    create(s, 'beta')
    expect(s.updateWorkspace(a.id, { name: 'BETA' })).toMatchObject({
      ok: false,
      error: { field: 'name' }
    })
    expect(s.updateWorkspace(a.id, { name: 'ALPHA' }).ok).toBe(true)
    expect(s.getState().workspaces[0].name).toBe('ALPHA')
  })

  it('rejects an empty name and an invalid directory without changing anything', () => {
    const s = make((d) => (d === '/bad' ? 'Not a directory' : null))
    const a = create(s, 'alpha')
    expect(s.updateWorkspace(a.id, { name: ' ' })).toMatchObject({
      ok: false,
      error: { field: 'name' }
    })
    expect(s.updateWorkspace(a.id, { directory: '/bad' })).toMatchObject({
      ok: false,
      error: { field: 'directory' }
    })
    expect(s.getState().workspaces[0]).toMatchObject({ name: 'alpha', directory: '/tmp/alpha' })
  })

  it('reports an unknown workspace', () => {
    const s = make()
    expect(s.updateWorkspace('nope', { name: 'x' })).toMatchObject({
      ok: false,
      error: { field: 'workspace' }
    })
  })
})

describe('select and delete (AC5/AC6 logic)', () => {
  it('selects a workspace and rejects an unknown id', () => {
    const s = make()
    create(s, 'alpha')
    const b = create(s, 'beta')
    ok(s.selectWorkspace(b.id))
    expect(s.getState().activeId).toBe(b.id)
    expect(s.selectWorkspace('nope').ok).toBe(false)
    expect(s.getState().activeId).toBe(b.id)
  })

  it('deleting the active workspace activates the first remaining one', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    const c = create(s, 'gamma')
    ok(s.selectWorkspace(b.id))
    ok(s.deleteWorkspace(b.id))
    expect(s.getState().activeId).toBe(a.id)
    ok(s.deleteWorkspace(a.id))
    expect(s.getState().activeId).toBe(c.id)
  })

  it('deleting an inactive workspace keeps the active one', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    ok(s.deleteWorkspace(b.id))
    expect(s.getState().activeId).toBe(a.id)
  })

  it('deleting the last workspace leaves none active', () => {
    const s = make()
    const a = create(s, 'alpha')
    ok(s.deleteWorkspace(a.id))
    expect(s.getState()).toEqual({ workspaces: [], activeId: null })
  })

  it('becomes active again after the empty state when creating', () => {
    const s = make()
    ok(s.deleteWorkspace(create(s, 'alpha').id))
    const b = create(s, 'beta')
    expect(s.getState().activeId).toBe(b.id)
  })

  it('frees a deleted name for reuse', () => {
    const s = make()
    ok(s.deleteWorkspace(create(s, 'alpha').id))
    expect(s.createWorkspace({ name: 'alpha', directory: '/tmp/alpha' }).ok).toBe(true)
  })

  it('reports an unknown workspace on delete', () => {
    expect(make().deleteWorkspace('nope').ok).toBe(false)
  })
})

describe('columns (AC7 logic)', () => {
  it('runs the spec sequence: add, rename, move, delete', () => {
    const s = make()
    const w = create(s, 'alpha')
    const col = (n: string): Column => s.getState().workspaces[0].columns.find((c) => c.name === n)!
    ok(s.addColumn(w.id, 'QA'))
    ok(s.renameColumn(w.id, col('In Progress').id, 'Doing'))
    ok(s.moveColumn(w.id, col('Done').id, 'left'))
    ok(s.deleteColumn(w.id, col('Review').id))
    expect(names(s.getState().workspaces[0])).toEqual(['Backlog', 'Doing', 'Done', 'QA'])
  })

  it('trims names and rejects empty or duplicate (case-insensitive) names on add', () => {
    const s = make()
    const w = create(s, 'alpha')
    const added = ok(s.addColumn(w.id, '  QA  '))
    expect(added.name).toBe('QA')
    for (const bad of ['', '  ', 'backlog', 'qa']) {
      expect(s.addColumn(w.id, bad)).toMatchObject({ ok: false, error: { field: 'column' } })
    }
    expect(s.getState().workspaces[0].columns).toHaveLength(5)
  })

  it('rejects empty and duplicate names on rename but allows re-casing itself', () => {
    const s = make()
    const w = create(s, 'alpha')
    const [backlog, running] = s.getState().workspaces[0].columns
    expect(s.renameColumn(w.id, running.id, 'done')).toMatchObject({
      ok: false,
      error: { field: 'column' }
    })
    expect(s.renameColumn(w.id, running.id, ' ')).toMatchObject({
      ok: false,
      error: { field: 'column' }
    })
    expect(s.renameColumn(w.id, backlog.id, 'BACKLOG').ok).toBe(true)
    expect(s.getState().workspaces[0].columns[0].name).toBe('BACKLOG')
  })

  it('moves right, and moving past an edge is a no-op', () => {
    const s = make()
    const w = create(s, 'alpha')
    const cols = s.getState().workspaces[0].columns
    ok(s.moveColumn(w.id, cols[0].id, 'right'))
    expect(names(s.getState().workspaces[0])).toEqual(['In Progress', 'Backlog', 'Review', 'Done'])
    ok(s.moveColumn(w.id, cols[3].id, 'right'))
    ok(s.moveColumn(w.id, cols[0].id, 'left'))
    ok(s.moveColumn(w.id, cols[0].id, 'left'))
    expect(names(s.getState().workspaces[0])).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
  })

  it('cannot delete the last remaining column', () => {
    const s = make()
    const w = create(s, 'alpha')
    for (const c of s.getState().workspaces[0].columns.slice(1)) ok(s.deleteColumn(w.id, c.id))
    const last = s.getState().workspaces[0].columns[0]
    expect(s.deleteColumn(w.id, last.id)).toMatchObject({ ok: false, error: { field: 'column' } })
    expect(s.getState().workspaces[0].columns).toHaveLength(1)
  })

  it('keeps boards independent between workspaces (AC4 logic)', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    ok(s.addColumn(a.id, 'QA'))
    expect(names(s.getState().workspaces[1])).toEqual([...DEFAULT_COLUMN_NAMES])
    expect(s.addColumn(b.id, 'QA').ok).toBe(true)
  })

  it('reports unknown workspace or column', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(s.addColumn('nope', 'x')).toMatchObject({ ok: false, error: { field: 'workspace' } })
    expect(s.renameColumn(w.id, 'nope', 'x')).toMatchObject({
      ok: false,
      error: { field: 'column' }
    })
    expect(s.moveColumn(w.id, 'nope', 'left').ok).toBe(false)
    expect(s.deleteColumn(w.id, 'nope').ok).toBe(false)
  })
})

describe('subscription and immutability', () => {
  it('notifies on change, not on rejected changes, and can unsubscribe', () => {
    const s = make()
    const listener = vi.fn()
    const off = s.subscribe(listener)
    create(s, 'alpha')
    expect(listener).toHaveBeenCalledTimes(1)
    s.createWorkspace({ name: 'alpha', directory: '/tmp/z' })
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    create(s, 'beta')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns new state objects on change so snapshots stay stable', () => {
    const s = make()
    const w = create(s, 'alpha')
    const before = s.getState()
    expect(s.getState()).toBe(before)
    ok(s.addColumn(w.id, 'QA'))
    expect(s.getState()).not.toBe(before)
    expect(before.workspaces[0].columns).toHaveLength(4)
  })
})

function card(s: InMemoryWorkspaceStore, w: Workspace, title: string, columnIndex = 0): Card {
  const ws = s.getState().workspaces.find((x) => x.id === w.id) ?? w
  return ok(s.createCard(w.id, ws.columns[columnIndex].id, title))
}

function titles(s: InMemoryWorkspaceStore, w: Workspace): string[] {
  const ws = s.getState().workspaces.find((x) => x.id === w.id)
  return (ws?.cards ?? []).map((c) => c.title)
}

describe('cards: create and default titles (AC2)', () => {
  it('numbers default titles per workspace and never reuses a number', () => {
    const s = make()
    const w = create(s, 'alpha')
    card(s, w, '')
    const two = card(s, w, '  ')
    card(s, w, '')
    ok(s.deleteCard(w.id, two.id))
    card(s, w, '')
    expect(titles(s, w)).toEqual(['Terminal 1', 'Terminal 3', 'Terminal 4'])
  })
  it('trims titles, allows duplicates and lists a column in creation order', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    card(s, w, '  api ')
    card(s, w, 'other', 1)
    card(s, w, 'api')
    const ws = s.getState().workspaces[0]
    expect(cardsInColumn(ws, backlog).map((c) => c.title)).toEqual(['api', 'api'])
    expect(cardsInColumn(ws, ws.columns[1].id).map((c) => c.title)).toEqual(['other'])
    expect(cardsInColumn(ws, ws.columns[2].id)).toEqual([])
  })

  it('counts default titles per workspace', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    card(s, a, '')
    card(s, a, 'named')
    card(s, b, '')
    card(s, a, '')
    expect(titles(s, a)).toEqual(['Terminal 1', 'named', 'Terminal 2'])
    expect(titles(s, b)).toEqual(['Terminal 1'])
  })

  it('reports an unknown workspace, column or card', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(s.createCard('nope', w.columns[0].id, 'x')).toMatchObject({
      ok: false,
      error: { field: 'workspace' }
    })
    expect(s.createCard(w.id, 'nope', 'x')).toMatchObject({ ok: false, error: { field: 'column' } })
    expect(s.deleteCard(w.id, 'nope')).toMatchObject({ ok: false, error: { field: 'card' } })
    expect(titles(s, w)).toEqual([])
  })
})

describe('cards: working directory (AC8)', () => {
  it('copies the directory at creation; later workspace edits only affect new cards', () => {
    const s = make()
    const w = create(s, 'alpha', '/tmp/bikube-alpha')
    const one = card(s, w, 'one')
    ok(s.updateWorkspace(w.id, { directory: '/tmp/bikube-other' }))
    const two = card(s, w, 'two')
    expect(one.directory).toBe('/tmp/bikube-alpha')
    expect(two.directory).toBe('/tmp/bikube-other')
    expect(s.getState().workspaces[0].cards.map((c) => c.directory)).toEqual([
      '/tmp/bikube-alpha',
      '/tmp/bikube-other'
    ])
  })
})

describe('cards: rename (AC9)', () => {
  it('renames with trimming and rejects a blank title, keeping the old one', () => {
    const s = make()
    const w = create(s, 'alpha')
    const api = card(s, w, 'api')
    expect(ok(s.renameCard(w.id, api.id, '  api v2 '))).toMatchObject({
      id: api.id,
      title: 'api v2',
      columnId: api.columnId,
      directory: api.directory
    })
    for (const blank of ['', '   ']) {
      expect(s.renameCard(w.id, api.id, blank)).toEqual({
        ok: false,
        error: { field: 'title', message: 'Title is required' }
      })
    }
    expect(titles(s, w)).toEqual(['api v2'])
  })

  it('allows a duplicate title and does not use the default counter', () => {
    const s = make()
    const w = create(s, 'alpha')
    card(s, w, 'api')
    const other = card(s, w, 'other')
    ok(s.renameCard(w.id, other.id, 'api'))
    card(s, w, '')
    expect(titles(s, w)).toEqual(['api', 'api', 'Terminal 1'])
  })

  it('reports an unknown workspace or card', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(s.renameCard('nope', 'x', 'y')).toMatchObject({
      ok: false,
      error: { field: 'workspace' }
    })
    expect(s.renameCard(w.id, 'nope', 'y')).toMatchObject({ ok: false, error: { field: 'card' } })
  })
})

describe('cards: delete column with cards (AC11 logic)', () => {
  it('refuses while the column has cards and works again once they are deleted', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    const api = card(s, w, 'api')
    expect(s.deleteColumn(w.id, backlog)).toEqual({
      ok: false,
      error: { field: 'column', message: 'Move or delete its cards first' }
    })
    expect(names(s.getState().workspaces[0])).toContain('Backlog')
    ok(s.deleteCard(w.id, api.id))
    ok(s.deleteColumn(w.id, backlog))
    expect(names(s.getState().workspaces[0])).toEqual(['In Progress', 'Review', 'Done'])
  })
})

describe('cards: workspace delete', () => {
  it('removes the workspace with its cards and leaves other boards alone', () => {
    const s = make()
    const a = create(s, 'alpha')
    const b = create(s, 'beta')
    card(s, a, 'one')
    card(s, b, 'two')
    ok(s.deleteWorkspace(a.id))
    expect(s.getState().workspaces.map((w) => w.cards.map((c) => c.title))).toEqual([['two']])
  })
})

describe('startup commands (#5 D2, D4, D10)', () => {
  function makeWithIds(): InMemoryWorkspaceStore {
    let n = 0
    return new InMemoryWorkspaceStore({ generateSessionId: () => `uuid-${++n}` })
  }

  it('gives a new workspace the Claude Code default and keeps a chosen one', () => {
    const s = makeWithIds()
    expect(create(s, 'alpha').defaultStartup).toEqual({ kind: 'claude' })
    const b = ok(
      s.createWorkspace({
        name: 'beta',
        directory: '/tmp/beta',
        defaultStartup: { kind: 'codex' }
      })
    )
    expect(b.defaultStartup).toEqual({ kind: 'codex' })
  })

  it('refuses Shell for a card or a workspace default: cards are agent sessions', () => {
    const s = makeWithIds()
    const refused = {
      ok: false,
      error: { field: 'command', message: 'Choose an agent or a custom command' }
    }
    expect(
      s.createWorkspace({ name: 'a', directory: '/tmp/a', defaultStartup: { kind: 'shell' } })
    ).toEqual(refused)
    const w = create(s, 'alpha')
    expect(s.updateWorkspace(w.id, { defaultStartup: { kind: 'shell' } })).toEqual(refused)
    expect(s.createCard(w.id, w.columns[0].id, 'x', { kind: 'shell' })).toEqual(refused)
    const c = card(s, w, 'c')
    expect(s.setCardStartup(w.id, c.id, { kind: 'shell' })).toEqual(refused)
  })

  it('validates and trims a Custom workspace default', () => {
    const s = makeWithIds()
    expect(
      s.createWorkspace({
        name: 'a',
        directory: '/tmp/a',
        defaultStartup: { kind: 'custom', command: ' ' }
      })
    ).toEqual({ ok: false, error: { field: 'command', message: 'Command is required' } })
    expect(s.getState().workspaces).toEqual([])
    const w = create(s, 'alpha')
    expect(
      ok(s.updateWorkspace(w.id, { defaultStartup: { kind: 'custom', command: ' codex ' } }))
        .defaultStartup
    ).toEqual({ kind: 'custom', command: 'codex' })
    expect(
      s.updateWorkspace(w.id, { defaultStartup: { kind: 'custom', command: '' } })
    ).toMatchObject({ ok: false, error: { field: 'command' } })
  })

  it('gives each card its own agent session id, not started, with the workspace default', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const one = card(s, w, 'one')
    const two = card(s, w, 'two')
    expect(one).toMatchObject({ startup: { kind: 'claude' }, claudeStarted: false })
    expect(one.agentSessionId).toBe('uuid-1')
    expect(two.agentSessionId).toBe('uuid-2')
  })

  it('creates a card with a chosen startup command, validating Custom (AC7)', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const col = w.columns[0].id
    expect(ok(s.createCard(w.id, col, 'agent', { kind: 'claude' })).startup).toEqual({
      kind: 'claude'
    })
    expect(
      ok(s.createCard(w.id, col, 'c', { kind: 'custom', command: ' echo bikube-custom ' })).startup
    ).toEqual({ kind: 'custom', command: 'echo bikube-custom' })
    expect(s.createCard(w.id, col, 'bad', { kind: 'custom', command: '' })).toEqual({
      ok: false,
      error: { field: 'command', message: 'Command is required' }
    })
    expect(titles(s, w)).toEqual(['agent', 'c'])
  })

  it('a failed create with a default title does not use up its number', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const col = w.columns[0].id
    expect(s.createCard(w.id, col, '', { kind: 'custom', command: '' }).ok).toBe(false)
    card(s, w, '')
    expect(titles(s, w)).toEqual(['Terminal 1'])
  })

  it('changing the workspace default never changes existing cards (AC8)', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const sh = card(s, w, 'sh')
    ok(s.updateWorkspace(w.id, { defaultStartup: { kind: 'claude' } }))
    const after = card(s, w, 'agent')
    const cards = s.getState().workspaces[0].cards
    expect(cards[0]).toEqual(sh)
    expect(after.startup).toEqual({ kind: 'claude' })
  })

  it('updating name or directory keeps the default', () => {
    const s = makeWithIds()
    const w = ok(
      s.createWorkspace({ name: 'alpha', directory: '/tmp/a', defaultStartup: { kind: 'claude' } })
    )
    expect(ok(s.updateWorkspace(w.id, { name: 'beta' })).defaultStartup).toEqual({ kind: 'claude' })
  })

  it("sets a card's startup command, keeping its agent session id and started flag (AC9)", () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const sh = card(s, w, 'sh')
    const claude = ok(s.setCardStartup(w.id, sh.id, { kind: 'claude' }))
    expect(claude).toEqual({ ...sh, startup: { kind: 'claude' } })
    ok(s.markClaudeStarted(w.id, sh.id))
    ok(s.setCardStartup(w.id, sh.id, { kind: 'custom', command: 'npm run dev' }))
    const back = ok(s.setCardStartup(w.id, sh.id, { kind: 'claude' }))
    expect(back).toMatchObject({ agentSessionId: sh.agentSessionId, claudeStarted: true })
    expect(s.getState().workspaces[0].cards[0]).toEqual(back)
  })

  it('rejects an empty Custom command or unknown card when setting, changing nothing', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const sh = card(s, w, 'sh')
    expect(s.setCardStartup(w.id, sh.id, { kind: 'custom', command: '  ' })).toEqual({
      ok: false,
      error: { field: 'command', message: 'Command is required' }
    })
    expect(s.setCardStartup(w.id, 'nope', { kind: 'claude' })).toMatchObject({
      ok: false,
      error: { field: 'card' }
    })
    expect(s.markClaudeStarted(w.id, 'nope')).toMatchObject({ ok: false, error: { field: 'card' } })
    expect(s.setCardStartup('nope', sh.id, { kind: 'claude' })).toMatchObject({
      ok: false,
      error: { field: 'workspace' }
    })
    expect(s.getState().workspaces[0].cards[0]).toEqual(sh)
  })

  it('marks Claude started on a card', () => {
    const s = makeWithIds()
    const w = create(s, 'alpha')
    const agent = ok(s.createCard(w.id, w.columns[0].id, 'agent', { kind: 'claude' }))
    expect(ok(s.markClaudeStarted(w.id, agent.id))).toEqual({ ...agent, claudeStarted: true })
    expect(s.getState().workspaces[0].cards[0].claudeStarted).toBe(true)
  })

  it('defaults to random UUIDs v4 for agent session ids', () => {
    const s = make()
    const w = create(s, 'alpha')
    const a = card(s, w, 'a')
    const b = card(s, w, 'b')
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(a.agentSessionId).toMatch(v4)
    expect(b.agentSessionId).toMatch(v4)
    expect(a.agentSessionId).not.toBe(b.agentSessionId)
  })
})

describe('agent presets (#21 D3, D5)', () => {
  it('creates a card with no preset started, whatever its startup command', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(ok(s.createCard(w.id, w.columns[0].id, 'cx', { kind: 'codex' }))).toMatchObject({
      startup: { kind: 'codex' },
      startedAgents: []
    })
    expect(card(s, w, 'sh').startedAgents).toEqual([])
  })

  it('marks a preset started once, keeping the others (AC1)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const cx = ok(s.createCard(w.id, w.columns[0].id, 'cx', { kind: 'codex' }))
    expect(ok(s.markAgentStarted(w.id, cx.id, 'codex'))).toEqual({
      ...cx,
      startedAgents: ['codex']
    })
    ok(s.markAgentStarted(w.id, cx.id, 'gemini'))
    ok(s.markAgentStarted(w.id, cx.id, 'codex'))
    expect(s.getState().workspaces[0].cards[0].startedAgents).toEqual(['codex', 'gemini'])
    expect(s.markAgentStarted(w.id, 'nope', 'codex')).toMatchObject({
      ok: false,
      error: { field: 'card' }
    })
  })

  it('keeps started presets when the startup command changes (AC4)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const sh = card(s, w, 'sh')
    ok(s.setCardStartup(w.id, sh.id, { kind: 'codex' }))
    ok(s.markAgentStarted(w.id, sh.id, 'codex'))
    ok(s.setCardStartup(w.id, sh.id, { kind: 'claude' }))
    expect(ok(s.setCardStartup(w.id, sh.id, { kind: 'codex' }))).toMatchObject({
      startup: { kind: 'codex' },
      startedAgents: ['codex'],
      claudeStarted: false
    })
  })

  it('takes a preset as the workspace default for new cards only (AC6)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const sh = card(s, w, 'sh')
    expect(
      ok(s.updateWorkspace(w.id, { defaultStartup: { kind: 'codex' } })).defaultStartup
    ).toEqual({ kind: 'codex' })
    expect(card(s, w, 'cx').startup).toEqual({ kind: 'codex' })
    expect(s.getState().workspaces[0].cards[0]).toEqual(sh)
  })
})

describe('cards: move (#6 D3, D4)', () => {
  function column(s: InMemoryWorkspaceStore, w: Workspace, columnIndex: number): string[] {
    const ws = s.getState().workspaces.find((x) => x.id === w.id)!
    return cardsInColumn(ws, ws.columns[columnIndex].id).map((c) => c.title)
  }

  it('reorders within a column up and down (AC2)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    card(s, w, 'a')
    card(s, w, 'b')
    const c = card(s, w, 'c')
    ok(s.moveCard(w.id, c.id, backlog, 0))
    expect(column(s, w, 0)).toEqual(['c', 'a', 'b'])
    ok(s.moveCard(w.id, c.id, backlog, 2))
    expect(column(s, w, 0)).toEqual(['a', 'b', 'c'])
  })
  it('moves to another column at top, middle and bottom (AC3)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const running = w.columns[1].id
    card(s, w, 'x', 1)
    const a = card(s, w, 'a')
    card(s, w, 'y', 1)
    const b = card(s, w, 'b')
    const c = card(s, w, 'c')
    ok(s.moveCard(w.id, a.id, running, 1))
    expect(column(s, w, 1)).toEqual(['x', 'a', 'y'])
    expect(column(s, w, 0)).toEqual(['b', 'c'])
    ok(s.moveCard(w.id, b.id, running, 0))
    expect(column(s, w, 1)).toEqual(['b', 'x', 'a', 'y'])
    ok(s.moveCard(w.id, c.id, running, 4))
    expect(column(s, w, 1)).toEqual(['b', 'x', 'a', 'y', 'c'])
    expect(column(s, w, 0)).toEqual([])
    expect(s.getState().workspaces[0].cards.find((x) => x.id === a.id)?.columnId).toBe(running)
  })
  it('puts an index past the end at the bottom and a negative one at the top', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    const done = w.columns[3].id
    const a = card(s, w, 'a')
    card(s, w, 'b')
    const c = card(s, w, 'c', 1)
    ok(s.moveCard(w.id, a.id, backlog, 99))
    expect(column(s, w, 0)).toEqual(['b', 'a'])
    ok(s.moveCard(w.id, a.id, backlog, -3))
    expect(column(s, w, 0)).toEqual(['a', 'b'])
    ok(s.moveCard(w.id, c.id, done, 5))
    expect(column(s, w, 3)).toEqual(['c'])
    expect(column(s, w, 1)).toEqual([])
  })

  it('rounds a fractional index down and puts NaN at the bottom', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    card(s, w, 'a')
    card(s, w, 'b')
    const c = card(s, w, 'c')
    card(s, w, 'x', 1)
    ok(s.moveCard(w.id, c.id, backlog, 0.5))
    expect(column(s, w, 0)).toEqual(['c', 'a', 'b'])
    expect(column(s, w, 1)).toEqual(['x'])
    ok(s.moveCard(w.id, c.id, backlog, NaN))
    expect(column(s, w, 0)).toEqual(['a', 'b', 'c'])
  })

  it('moving to the same place succeeds and changes nothing', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    card(s, w, 'a')
    const b = card(s, w, 'b')
    card(s, w, 'c')
    const before = s.getState()
    const listener = vi.fn()
    s.subscribe(listener)
    expect(s.moveCard(w.id, b.id, backlog, 1)).toEqual({ ok: true, value: undefined })
    expect(s.getState()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(column(s, w, 0)).toEqual(['a', 'b', 'c'])
  })

  it('reports an unknown workspace, card or column and changes nothing', () => {
    const s = make()
    const w = create(s, 'alpha')
    const a = card(s, w, 'a')
    const before = s.getState()
    expect(s.moveCard('nope', a.id, w.columns[1].id, 0)).toEqual({
      ok: false,
      error: { field: 'workspace', message: 'Workspace not found' }
    })
    expect(s.moveCard(w.id, 'nope', w.columns[1].id, 0)).toEqual({
      ok: false,
      error: { field: 'card', message: 'Card not found' }
    })
    expect(s.moveCard(w.id, a.id, 'nope', 0)).toEqual({
      ok: false,
      error: { field: 'column', message: 'Column not found' }
    })
    expect(s.getState()).toBe(before)
  })

  it("changes only the moved card's column and position (D4)", () => {
    const s = make()
    const w = create(s, 'alpha')
    create(s, 'beta')
    const a = card(s, w, 'a')
    const b = card(s, w, 'b')
    ok(s.setCardStartup(w.id, a.id, { kind: 'claude' }))
    ok(s.markClaudeStarted(w.id, a.id))
    const beforeWs = s.getState().workspaces[0]
    const beforeA = beforeWs.cards.find((c) => c.id === a.id)!
    const beforeB = beforeWs.cards.find((c) => c.id === b.id)!
    const beforeOther = s.getState().workspaces[1]
    ok(s.moveCard(w.id, a.id, w.columns[2].id, 0))
    const after = s.getState().workspaces[0]
    expect(after.cards.find((c) => c.id === a.id)).toEqual({
      ...beforeA,
      columnId: w.columns[2].id
    })
    expect(after.cards.find((c) => c.id === b.id)).toBe(beforeB)
    expect({ ...after, cards: [] }).toEqual({ ...beforeWs, cards: [] })
    expect(s.getState().workspaces[1]).toBe(beforeOther)
  })
  it('lets a column be deleted once its cards are moved out (AC10)', () => {
    const s = make()
    const w = create(s, 'alpha')
    const backlog = w.columns[0].id
    const a = card(s, w, 'a')
    expect(s.deleteColumn(w.id, backlog)).toEqual({
      ok: false,
      error: { field: 'column', message: 'Move or delete its cards first' }
    })
    ok(s.moveCard(w.id, a.id, w.columns[1].id, 0))
    ok(s.deleteColumn(w.id, backlog))
    expect(names(s.getState().workspaces[0])).toEqual(['In Progress', 'Review', 'Done'])
    expect(column(s, w, 0)).toEqual(['a'])
  })
})

describe('workspaces: move (#32 D1, D2)', () => {
  function order(s: InMemoryWorkspaceStore): string[] {
    return s.getState().workspaces.map((w) => w.name)
  }

  function three(s: InMemoryWorkspaceStore): Workspace[] {
    return [create(s, 'alpha'), create(s, 'beta'), create(s, 'gamma')]
  }

  it('moves up, down, to the top and to the bottom (AC1)', () => {
    const s = make()
    const [a, b, g] = three(s)
    ok(s.moveWorkspace(b.id, 0))
    expect(order(s)).toEqual(['beta', 'alpha', 'gamma'])
    ok(s.moveWorkspace(b.id, 1))
    expect(order(s)).toEqual(['alpha', 'beta', 'gamma'])
    ok(s.moveWorkspace(g.id, 0))
    expect(order(s)).toEqual(['gamma', 'alpha', 'beta'])
    ok(s.moveWorkspace(g.id, 2))
    expect(order(s)).toEqual(['alpha', 'beta', 'gamma'])
    ok(s.moveWorkspace(a.id, 2))
    expect(order(s)).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('puts an index past the end at the bottom and rounds as moveCard does', () => {
    const s = make()
    const [a, , g] = three(s)
    ok(s.moveWorkspace(a.id, 99))
    expect(order(s)).toEqual(['beta', 'gamma', 'alpha'])
    ok(s.moveWorkspace(a.id, -3))
    expect(order(s)).toEqual(['alpha', 'beta', 'gamma'])
    ok(s.moveWorkspace(g.id, 0.5))
    expect(order(s)).toEqual(['gamma', 'alpha', 'beta'])
    ok(s.moveWorkspace(g.id, NaN))
    expect(order(s)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('moving to the same place succeeds and changes nothing', () => {
    const s = make()
    const [, b] = three(s)
    const before = s.getState()
    const listener = vi.fn()
    s.subscribe(listener)
    expect(s.moveWorkspace(b.id, 1)).toEqual({ ok: true, value: undefined })
    expect(s.getState()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports an unknown workspace and changes nothing', () => {
    const s = make()
    three(s)
    const before = s.getState()
    expect(s.moveWorkspace('nope', 0)).toEqual({
      ok: false,
      error: { field: 'workspace', message: 'Workspace not found' }
    })
    expect(s.getState()).toBe(before)
  })

  it('changes only the order: the active id and every workspace are kept (D2)', () => {
    const s = make()
    const [a, b, g] = three(s)
    card(s, b, 'running')
    ok(s.createShell(b.id, { name: 'dev', command: 'npm run dev', autostart: true }))
    const before = s.getState().workspaces
    ok(s.moveWorkspace(b.id, 0))
    const after = s.getState()
    expect(after.activeId).toBe(a.id)
    expect(after.workspaces).toEqual([before[1], before[0], before[2]])
    after.workspaces.forEach((w) => expect(w).toBe(before.find((x) => x.id === w.id)))
    expect(after.workspaces.map((w) => w.id)).toEqual([b.id, a.id, g.id])
  })
})

describe('initial state (#8 D5, AC5)', () => {
  it('starts from a seeded state and continues its default titles', () => {
    const seed = new InMemoryWorkspaceStore()
    const ws = create(seed, 'alpha')
    ok(seed.createCard(ws.id, ws.columns[0].id, ''))
    ok(seed.createCard(ws.id, ws.columns[0].id, ''))
    const s = new InMemoryWorkspaceStore({
      initialState: seed.getState(),
      generateId: () => 'new-card'
    })
    expect(s.getState()).toEqual(seed.getState())
    const card = ok(s.createCard(ws.id, ws.columns[1].id, ''))
    expect(card.title).toBe('Terminal 3')
    expect(s.getState().workspaces[0].cards.map((c) => c.title)).toEqual([
      'Terminal 1',
      'Terminal 2',
      'Terminal 3'
    ])
  })
})

describe('SSH workspaces (#12 D1, D2, D3)', () => {
  const never = (): string => 'This path does not exist or is not a directory'

  it('creates an SSH workspace with a trimmed host, not checking the directory locally', () => {
    const s = make(never)
    const ws = ok(s.createWorkspace({ name: '', directory: '/nope/remote', host: ' me@devbox ' }))
    expect(ws.host).toBe('me@devbox')
    expect(ws.directory).toBe('/nope/remote')
    expect(ws.name).toBe('remote')
  })

  it('names an SSH workspace in ~ after its host', () => {
    const ws = ok(make().createWorkspace({ name: '', directory: '~', host: 'devbox' }))
    expect(ws.name).toBe('devbox')
  })

  it('keeps local workspaces without a host', () => {
    const s = make()
    const ws = ok(s.createWorkspace({ name: 'a', directory: '/tmp/a', host: null }))
    expect('host' in ws).toBe(false)
    expect('host' in create(s, 'b')).toBe(false)
  })

  it('rejects a bad host or remote directory and creates nothing', () => {
    const s = make()
    expect(s.createWorkspace({ name: 'a', directory: '/tmp', host: '-oProxyCommand=x' })).toEqual({
      ok: false,
      error: { field: 'host', message: 'Enter a host as ssh takes it, e.g. me@devbox' }
    })
    expect(s.createWorkspace({ name: 'a', directory: '/tmp', host: '' })).toEqual({
      ok: false,
      error: { field: 'host', message: 'Host is required' }
    })
    expect(s.createWorkspace({ name: 'a', directory: 'relative/dir', host: 'devbox' })).toEqual({
      ok: false,
      error: { field: 'directory', message: 'Enter an absolute path or one starting with ~' }
    })
    expect(s.getState().workspaces).toEqual([])
  })

  it('copies the host to cards at creation; edits change new cards only (D1)', () => {
    const s = make(never)
    const ws = ok(s.createWorkspace({ name: 'remote', directory: '~/api', host: 'me@devbox' }))
    const col = ws.columns[0].id
    const a = ok(s.createCard(ws.id, col, 'a'))
    expect(a.host).toBe('me@devbox')
    expect(a.directory).toBe('~/api')
    ok(s.updateWorkspace(ws.id, { host: 'other' }))
    const b = ok(s.createCard(ws.id, col, 'b'))
    expect(b.host).toBe('other')
    const after = s.getState().workspaces[0]
    expect(after.host).toBe('other')
    expect(after.cards.find((c) => c.id === a.id)?.host).toBe('me@devbox')
  })

  it('switches a workspace to local with host null, checking the directory locally again', () => {
    const s = make((d) => (d === '/tmp' ? null : 'missing'))
    const ws = ok(s.createWorkspace({ name: 'remote', directory: '~', host: 'devbox' }))
    expect(s.updateWorkspace(ws.id, { host: null })).toMatchObject({
      ok: false,
      error: { field: 'directory' }
    })
    const local = ok(s.updateWorkspace(ws.id, { host: null, directory: '/tmp' }))
    expect('host' in local).toBe(false)
    const card = ok(s.createCard(ws.id, ws.columns[0].id, 'c'))
    expect('host' in card).toBe(false)
  })

  it('switches a local workspace to SSH, checking the directory by D3', () => {
    const s = make()
    const ws = create(s, 'a')
    expect(s.updateWorkspace(ws.id, { host: '-x' })).toMatchObject({
      ok: false,
      error: { field: 'host' }
    })
    expect(ok(s.updateWorkspace(ws.id, { host: 'devbox' })).host).toBe('devbox')
    expect(s.updateWorkspace(ws.id, { directory: 'rel' })).toMatchObject({
      ok: false,
      error: { field: 'directory' }
    })
  })
})

describe('replacing the whole board (#13 D7, D14)', () => {
  it('takes the new workspaces and keeps the active one when it still exists', () => {
    const s = make()
    const api = create(s, 'api')
    const web = create(s, 'web')
    ok(s.selectWorkspace(web.id))
    const listener = vi.fn()
    s.subscribe(listener)
    s.replaceBoard([{ ...api, name: 'api2' }, web])
    expect(s.getState()).toEqual({ workspaces: [{ ...api, name: 'api2' }, web], activeId: web.id })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('makes the first workspace active when the active one is gone, or none when empty', () => {
    const s = make()
    const api = create(s, 'api')
    const web = create(s, 'web')
    ok(s.selectWorkspace(web.id))
    s.replaceBoard([api])
    expect(s.getState().activeId).toBe(api.id)
    s.replaceBoard([])
    expect(s.getState()).toEqual({ workspaces: [], activeId: null })
  })

  it('makes the first workspace active when there was none', () => {
    const s = make()
    const other = make()
    const api = create(other, 'api')
    s.replaceBoard([api])
    expect(s.getState()).toEqual({ workspaces: [api], activeId: api.id })
  })
})

describe('cards with their own worktree', () => {
  const worktree = {
    directory: '/data/worktrees/repo-abc123/fix-login/app',
    worktree: {
      path: '/data/worktrees/repo-abc123/fix-login',
      branch: 'bikube/fix-login',
      repo: '/tmp/repo'
    }
  }

  it('runs a local card in its worktree and keeps where the worktree is', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'alpha', directory: '/tmp/repo' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'fix login', undefined, worktree))
    expect(c.directory).toBe(worktree.directory)
    expect(c.worktree).toEqual(worktree.worktree)
    // An ordinary card is unchanged.
    const plain = ok(s.createCard(w.id, w.columns[0].id, 'plain'))
    expect(plain.directory).toBe('/tmp/repo')
    expect(plain).not.toHaveProperty('worktree')
  })

  it('ignores a worktree for an SSH workspace', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'remote', directory: '~/api', host: 'devbox' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'x', undefined, worktree))
    expect(c.directory).toBe('~/api')
    expect(c).not.toHaveProperty('worktree')
  })
})

describe('shells', () => {
  it("adds, edits and deletes a workspace's shells, trimming and checking their fields", () => {
    const s = make()
    const w = create(s, 'alpha')
    expect(w.shells).toEqual([])
    const dev = ok(
      s.createShell(w.id, { name: ' Dev server ', command: ' npm run dev ', autostart: true })
    )
    expect(dev).toMatchObject({ name: 'Dev server', command: 'npm run dev', autostart: true })
    const plain = ok(s.createShell(w.id, { name: 'Scratch', command: '', autostart: false }))
    expect(s.getState().workspaces[0].shells.map((sh) => sh.name)).toEqual([
      'Dev server',
      'Scratch'
    ])

    expect(s.createShell(w.id, { name: ' ', command: '', autostart: false })).toMatchObject({
      ok: false,
      error: { field: 'name' }
    })
    expect(
      s.createShell(w.id, { name: 'Two lines', command: 'a\nb', autostart: false })
    ).toMatchObject({ ok: false, error: { field: 'command' } })

    expect(dev.type).toBe('shell')
    ok(
      s.updateShell(w.id, dev.id, {
        name: 'Web',
        command: 'npm start',
        autostart: false,
        type: 'trigger'
      })
    )
    expect(s.getState().workspaces[0].shells[0]).toEqual({
      id: dev.id,
      name: 'Web',
      command: 'npm start',
      autostart: false,
      type: 'trigger'
    })
    // A trigger needs a command.
    expect(
      s.updateShell(w.id, dev.id, { name: 'Web', command: ' ', autostart: false, type: 'trigger' })
    ).toEqual({ ok: false, error: { field: 'command', message: 'A trigger needs a command' } })
    // A trigger types `<command>; exit`: endings and comments that break it.
    for (const command of ['npm run dev;', 'npm run dev &', 'a |', 'a &&', 'npm run dev # note']) {
      expect(
        s.updateShell(w.id, dev.id, { name: 'Web', command, autostart: false, type: 'trigger' })
      ).toMatchObject({ ok: false, error: { field: 'command' } })
      // A shell types them as written.
      ok(s.updateShell(w.id, dev.id, { name: 'Web', command, autostart: false }))
    }
    ok(
      s.updateShell(w.id, dev.id, {
        name: 'Web',
        command: 'echo a#b',
        autostart: false,
        type: 'trigger'
      })
    )
    ok(s.deleteShell(w.id, plain.id))
    expect(s.getState().workspaces[0].shells.map((sh) => sh.id)).toEqual([dev.id])
  })
})

describe('worktree setup (#39 D1)', () => {
  it('is empty for a new workspace, set trimmed on create and edit, and kept by other edits', () => {
    const s = make()
    expect(create(s, 'alpha').worktreeSetup).toBe('')
    const w = ok(s.createWorkspace({ name: 'b', directory: '/tmp/b', worktreeSetup: ' npm ci ' }))
    expect(w.worktreeSetup).toBe('npm ci')
    expect(ok(s.updateWorkspace(w.id, { name: 'beta' })).worktreeSetup).toBe('npm ci')
    expect(ok(s.updateWorkspace(w.id, { worktreeSetup: ' uv sync ' })).worktreeSetup).toBe(
      'uv sync'
    )
    expect(ok(s.updateWorkspace(w.id, { worktreeSetup: '  ' })).worktreeSetup).toBe('')
  })

  it('refuses more than one line under its own field, saving nothing', () => {
    const s = make()
    const refused = { ok: false, error: { field: 'setup', message: 'Command must be one line' } }
    expect(s.createWorkspace({ name: 'a', directory: '/tmp/a', worktreeSetup: 'a\nb' })).toEqual(
      refused
    )
    expect(s.getState().workspaces).toEqual([])
    const w = create(s, 'alpha')
    expect(s.updateWorkspace(w.id, { name: 'beta', worktreeSetup: 'a\rb' })).toEqual(refused)
    expect(s.getState().workspaces[0]).toBe(w)
  })

  it('refuses a setup ending in ; & or |, which would never report back (D1)', () => {
    const s = make()
    const refused = {
      ok: false,
      error: { field: 'setup', message: "Command can't end with ; & or |" }
    }
    for (const setup of ['npm ci;', 'npm ci &', 'npm ci |', ' npm ci; ', 'a && b &&']) {
      expect(s.createWorkspace({ name: 'a', directory: '/tmp/a', worktreeSetup: setup })).toEqual(
        refused
      )
    }
    expect(s.getState().workspaces).toEqual([])
    const w = create(s, 'alpha')
    expect(s.updateWorkspace(w.id, { worktreeSetup: 'npm ci ||' })).toEqual(refused)
    expect(s.getState().workspaces[0]).toBe(w)
    expect(
      ok(s.updateWorkspace(w.id, { worktreeSetup: 'echo "a;b" && cp x y' })).worktreeSetup
    ).toBe('echo "a;b" && cp x y')
  })

  it('is kept when the workspace becomes SSH', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/a', worktreeSetup: 'npm ci' }))
    const ssh = ok(s.updateWorkspace(w.id, { host: 'devbox', directory: '~/a' }))
    expect(ssh.worktreeSetup).toBe('npm ci')
  })
})

describe("a card's pending setup (#39 D2)", () => {
  const worktree = {
    directory: '/data/worktrees/repo-abc123/fix',
    worktree: { path: '/data/worktrees/repo-abc123/fix', branch: 'bikube/fix', repo: '/tmp/repo' }
  }

  it('is copied from the workspace to a card created with its own worktree only', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo', worktreeSetup: 'npm ci' }))
    const col = w.columns[0].id
    expect(ok(s.createCard(w.id, col, 'wt', undefined, worktree)).setup).toBe('npm ci')
    expect(ok(s.createCard(w.id, col, 'plain'))).not.toHaveProperty('setup')
    ok(s.updateWorkspace(w.id, { worktreeSetup: '' }))
    expect(ok(s.createCard(w.id, col, 'none', undefined, worktree))).not.toHaveProperty('setup')
  })

  it('is never given to an SSH card', () => {
    const s = make()
    const w = ok(
      s.createWorkspace({ name: 'r', directory: '~/a', host: 'devbox', worktreeSetup: 'npm ci' })
    )
    expect(ok(s.createCard(w.id, w.columns[0].id, 'x', undefined, worktree))).not.toHaveProperty(
      'setup'
    )
  })

  it('is cleared for good once it succeeded or was skipped (D4, D6)', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo', worktreeSetup: 'npm ci' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'wt', undefined, worktree))
    const cleared = ok(s.clearCardSetup(w.id, c.id))
    expect(cleared).not.toHaveProperty('setup')
    expect(s.getState().workspaces[0].cards[0]).toEqual(cleared)
    expect(ok(s.clearCardSetup(w.id, c.id))).toEqual(cleared)
  })
})

describe('logo (#59 D1, D2, AC5)', () => {
  it('has no logo key for a new workspace, sets one on create and edit, keeps it, and clears it with null', () => {
    const s = make()
    expect('logo' in create(s, 'alpha')).toBe(false)
    const w = ok(s.createWorkspace({ name: 'b', directory: '/tmp/b', logo: 'rocket' }))
    expect(w.logo).toBe('rocket')
    expect(ok(s.updateWorkspace(w.id, { name: 'beta' })).logo).toBe('rocket')
    expect(ok(s.updateWorkspace(w.id, { logo: 'database' })).logo).toBe('database')
    const cleared = ok(s.updateWorkspace(w.id, { logo: null }))
    expect('logo' in cleared).toBe(false)
    expect('logo' in ok(s.createWorkspace({ name: 'c', directory: '/tmp/c', logo: null }))).toBe(
      false
    )
  })

  it('refuses an id not in the list, saving nothing', () => {
    const s = make()
    const refused = { ok: false, error: { field: 'logo', message: 'Unknown logo' } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = 'not-a-logo' as any
    expect(s.createWorkspace({ name: 'a', directory: '/tmp/a', logo: bad })).toEqual(refused)
    expect(s.getState().workspaces).toEqual([])
    const w = ok(s.createWorkspace({ name: 'b', directory: '/tmp/b', logo: 'rocket' }))
    expect(s.updateWorkspace(w.id, { name: 'beta', logo: bad })).toEqual(refused)
    expect(s.getState().workspaces[0]).toBe(w)
  })
})

describe('automatic move rules (#42 D2, D9, AC12)', () => {
  it('has no autoMove key for a new workspace, sets rules by column id, keeps them, and clears them', () => {
    const s = make()
    const w = create(s, 'alpha')
    expect('autoMove' in w).toBe(false)
    const [backlog, running, , done] = w.columns
    const set = ok(s.updateWorkspace(w.id, { autoMove: { waiting: running.id, stopped: done.id } }))
    expect(set.autoMove).toEqual({ waiting: running.id, stopped: done.id })
    expect(ok(s.updateWorkspace(w.id, { name: 'beta' })).autoMove).toEqual(set.autoMove)
    expect(ok(s.updateWorkspace(w.id, { autoMove: { working: backlog.id } })).autoMove).toEqual({
      working: backlog.id
    })
    expect('autoMove' in ok(s.updateWorkspace(w.id, { autoMove: {} }))).toBe(false)
  })

  it('refuses a rule naming a column the workspace does not have, saving nothing', () => {
    const s = make()
    const w = create(s, 'alpha')
    const other = create(s, 'beta')
    const refused = s.updateWorkspace(w.id, {
      name: 'gamma',
      autoMove: { waiting: other.columns[0].id }
    })
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ field: 'column', message: 'Column not found' })
    expect(s.getState().workspaces[0]).toBe(w)
  })

  it('keeps a rule when its column is renamed', () => {
    const s = make()
    const w = create(s, 'alpha')
    const review = w.columns[2]
    ok(s.updateWorkspace(w.id, { autoMove: { waiting: review.id } }))
    ok(s.renameColumn(w.id, review.id, 'Needs me'))
    expect(s.getState().workspaces[0].autoMove).toEqual({ waiting: review.id })
  })

  it('turns off every rule naming a deleted column, in the same change', () => {
    const s = make()
    const w = create(s, 'alpha')
    const [backlog, , review] = w.columns
    ok(
      s.updateWorkspace(w.id, {
        autoMove: { working: review.id, waiting: review.id, stopped: backlog.id }
      })
    )
    const listener = vi.fn()
    s.subscribe(listener)
    ok(s.deleteColumn(w.id, review.id))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(s.getState().workspaces[0].autoMove).toEqual({ stopped: backlog.id })
    ok(s.deleteColumn(w.id, backlog.id))
    expect('autoMove' in s.getState().workspaces[0]).toBe(false)
  })
})

describe('moveCardToWorktree', () => {
  const worktree = {
    directory: '/data/worktrees/repo-abc123/fix',
    worktree: { path: '/data/worktrees/repo-abc123/fix', branch: 'bikube/fix', repo: '/tmp/repo' }
  }

  it('moves a plain local card into the worktree, with the setup and a fresh agent session', () => {
    let sessions = 0
    const s = new InMemoryWorkspaceStore({ generateSessionId: () => `session-${++sessions}` })
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo', worktreeSetup: 'npm ci' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'fix'))
    ok(s.markClaudeStarted(w.id, c.id))
    ok(s.markAgentStarted(w.id, c.id, 'codex'))
    const moved = ok(s.moveCardToWorktree(w.id, c.id, worktree))
    expect(moved).toEqual({
      ...c,
      directory: worktree.directory,
      worktree: worktree.worktree,
      setup: 'npm ci',
      agentSessionId: 'session-2',
      claudeStarted: false,
      startedAgents: []
    })
    expect(s.getState().workspaces[0].cards[0]).toEqual(moved)
  })

  it('adds no setup when the workspace has none', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'fix'))
    expect(ok(s.moveCardToWorktree(w.id, c.id, worktree))).not.toHaveProperty('setup')
  })

  it('refuses a card that has a worktree already and an SSH card, changing nothing', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'wt', undefined, worktree))
    const r = ok(s.createWorkspace({ name: 'r', directory: '~/a', host: 'devbox' }))
    const remote = ok(s.createCard(r.id, r.columns[0].id, 'x'))
    const before = s.getState()
    expect(s.moveCardToWorktree(w.id, c.id, worktree)).toMatchObject({ ok: false })
    expect(s.moveCardToWorktree(r.id, remote.id, worktree)).toMatchObject({ ok: false })
    expect(s.getState()).toBe(before)
  })
})

describe('moveCardOutOfWorktree', () => {
  const worktree = {
    directory: '/data/worktrees/repo-abc123/fix',
    worktree: { path: '/data/worktrees/repo-abc123/fix', branch: 'bikube/fix', repo: '/tmp/repo' }
  }

  it('runs a worktree card in the workspace folder, with a fresh agent session and no setup', () => {
    let sessions = 0
    const s = new InMemoryWorkspaceStore({ generateSessionId: () => `session-${++sessions}` })
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo', worktreeSetup: 'npm ci' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'fix'))
    ok(s.moveCardToWorktree(w.id, c.id, worktree))
    ok(s.markAgentStarted(w.id, c.id, 'codex'))
    const moved = ok(s.moveCardOutOfWorktree(w.id, c.id))
    expect(moved).toEqual({
      ...c,
      directory: '/tmp/repo',
      agentSessionId: 'session-3',
      claudeStarted: false,
      startedAgents: []
    })
    expect(s.getState().workspaces[0].cards[0]).toEqual(moved)
  })

  it('refuses a card without a worktree, changing nothing', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo' }))
    const c = ok(s.createCard(w.id, w.columns[0].id, 'plain'))
    const before = s.getState()
    expect(s.moveCardOutOfWorktree(w.id, c.id)).toMatchObject({ ok: false })
    expect(s.getState()).toBe(before)
  })
})

describe('setShellRunIn', () => {
  const worktree = {
    directory: '/data/worktrees/repo-abc123/fix',
    worktree: { path: '/data/worktrees/repo-abc123/fix', branch: 'bikube/fix', repo: '/tmp/repo' }
  }

  it("sets a shell's worktree card and clears it; an edit keeps it", () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo' }))
    const k = ok(s.createCard(w.id, w.columns[0].id, 'fix', undefined, worktree))
    const sh = ok(s.createShell(w.id, { name: 'Dev', command: 'npm run dev', autostart: false }))
    expect(ok(s.setShellRunIn(w.id, sh.id, k.id)).runIn).toBe(k.id)
    expect(
      ok(s.updateShell(w.id, sh.id, { name: 'Web', command: '', autostart: false })).runIn
    ).toBe(k.id)
    expect(ok(s.setShellRunIn(w.id, sh.id, null))).not.toHaveProperty('runIn')
  })

  it('refuses a card without its own worktree and an unknown shell', () => {
    const s = make()
    const w = ok(s.createWorkspace({ name: 'a', directory: '/tmp/repo' }))
    const plain = ok(s.createCard(w.id, w.columns[0].id, 'plain'))
    const sh = ok(s.createShell(w.id, { name: 'Dev', command: '', autostart: false }))
    expect(s.setShellRunIn(w.id, sh.id, plain.id)).toMatchObject({ ok: false })
    expect(s.setShellRunIn(w.id, 'nope', null)).toMatchObject({ ok: false })
  })
})

describe('temporary shells (#66 D2, D3)', () => {
  it('adds a plain shell named Terminal N, N the lowest free, marked temporary', () => {
    const s = make()
    const w = create(s, 'alpha')
    const one = ok(s.createTemporaryShell(w.id))
    expect(one).toEqual({
      id: one.id,
      name: 'Terminal 1',
      command: '',
      autostart: false,
      type: 'shell',
      temporary: true
    })
    const two = ok(s.createTemporaryShell(w.id))
    expect(two.name).toBe('Terminal 2')
    ok(s.deleteShell(w.id, one.id))
    expect(ok(s.createTemporaryShell(w.id)).name).toBe('Terminal 1')
    // A named shell holding the name counts too.
    ok(s.createShell(w.id, { name: 'Terminal 3', command: '', autostart: false }))
    expect(ok(s.createTemporaryShell(w.id)).name).toBe('Terminal 4')
    expect(s.createTemporaryShell('nope')).toMatchObject({ ok: false })
  })

  it('stays temporary when edited', () => {
    const s = make()
    const w = create(s, 'alpha')
    const t = ok(s.createTemporaryShell(w.id))
    expect(
      ok(s.updateShell(w.id, t.id, { name: 'X', command: '', autostart: false })).temporary
    ).toBe(true)
    // A named shell is never temporary.
    const named = ok(s.createShell(w.id, { name: 'Dev', command: '', autostart: false }))
    expect(named.temporary).toBeUndefined()
  })
})

describe('workspace views and card open times', () => {
  it('creates a workspace following the default with no view key, or with its own view', () => {
    const s = make()
    expect('view' in create(s, 'alpha')).toBe(false)
    expect(
      'view' in ok(s.createWorkspace({ name: 'b', directory: '/tmp/b', view: 'default' }))
    ).toBe(false)
    expect(ok(s.createWorkspace({ name: 'c', directory: '/tmp/c', view: 'grid' })).view).toBe(
      'grid'
    )
    expect(ok(s.createWorkspace({ name: 'd', directory: '/tmp/d', view: 'kanban' })).view).toBe(
      'kanban'
    )
  })

  it("shows its own view, or without one Settings' default", () => {
    expect(workspaceView({}, 'grid')).toBe('grid')
    expect(workspaceView({ view: 'kanban' }, 'grid')).toBe('kanban')
    expect(workspaceViewChoice({})).toBe('default')
    expect(workspaceViewChoice({ view: 'grid' })).toBe('grid')
  })

  it('switches a workspace between views without changing any card', () => {
    const s = make()
    const w = create(s, 'alpha')
    card(s, w, 'api', 1)
    const before = s.getState().workspaces[0].cards
    expect(ok(s.updateWorkspace(w.id, { view: 'grid' })).view).toBe('grid')
    expect(s.getState().workspaces[0].cards).toBe(before)
    expect(ok(s.updateWorkspace(w.id, { view: 'kanban' })).view).toBe('kanban')
    expect('view' in ok(s.updateWorkspace(w.id, { view: 'default' }))).toBe(false)
    expect(s.getState().workspaces[0].cards).toBe(before)
    expect(s.updateWorkspace(w.id, { view: 'list' as never })).toMatchObject({ ok: false })
  })

  it("stamps a new card's creation with the store's clock, and none without one", () => {
    const plain = make()
    expect('createdAt' in card(plain, create(plain, 'x'), 'api')).toBe(false)
    const s = new InMemoryWorkspaceStore({ now: () => 1000 })
    const w = create(s, 'alpha')
    const api = card(s, w, 'api')
    expect(api.createdAt).toBe(1000)
    expect('lastOpenedAt' in api).toBe(false)
  })

  it('records when a card is opened, changing nothing else', () => {
    const s = make()
    const w = create(s, 'alpha')
    const api = card(s, w, 'api')
    expect(ok(s.markCardOpened(w.id, api.id, 5))).toEqual({ ...api, lastOpenedAt: 5 })
    const state = s.getState()
    ok(s.markCardOpened(w.id, api.id, 5))
    expect(s.getState()).toBe(state)
    expect(s.markCardOpened(w.id, 'nope', 5)).toMatchObject({ ok: false, error: { field: 'card' } })
  })

  it("keeps a card's last status and usage, '' and no tokens forgetting them, the same saving nothing", () => {
    const s = make()
    const w = create(s, 'alpha')
    const api = card(s, w, 'api')
    const usage = {
      input: 1,
      output: 2,
      cacheWrite: 3,
      cacheRead: 4,
      tokens: 10,
      context: 7,
      model: 'claude-opus-5-5'
    }
    expect(ok(s.setCardLastStatus(w.id, api.id, 'Tests green'))).toEqual({
      ...api,
      lastStatus: 'Tests green'
    })
    expect(ok(s.setCardLastUsage(w.id, api.id, usage)).lastUsage).toEqual(usage)
    const state = s.getState()
    ok(s.setCardLastStatus(w.id, api.id, 'Tests green'))
    ok(s.setCardLastUsage(w.id, api.id, { ...usage }))
    expect(s.getState()).toBe(state)
    expect('lastStatus' in ok(s.setCardLastStatus(w.id, api.id, ''))).toBe(false)
    expect('lastUsage' in ok(s.setCardLastUsage(w.id, api.id, { ...usage, tokens: 0 }))).toBe(false)
    expect(s.setCardLastStatus(w.id, 'nope', 'x')).toMatchObject({
      ok: false,
      error: { field: 'card' }
    })
  })
})
