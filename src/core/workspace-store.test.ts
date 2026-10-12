import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COLUMN_NAMES,
  InMemoryWorkspaceStore,
  basename,
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
    expect(names(w)).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
    expect(DEFAULT_COLUMN_NAMES).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
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
    ok(s.addColumn(a.id, 'Review'))
    ok(s.updateWorkspace(a.id, { name: 'gamma' }))
    expect(names(s.getState().workspaces[0])).toContain('Review')
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
    ok(s.addColumn(w.id, 'Review'))
    ok(s.renameColumn(w.id, col('Running').id, 'Doing'))
    ok(s.moveColumn(w.id, col('Done').id, 'left'))
    ok(s.deleteColumn(w.id, col('Needs me').id))
    expect(names(s.getState().workspaces[0])).toEqual(['Backlog', 'Doing', 'Done', 'Review'])
  })

  it('trims names and rejects empty or duplicate (case-insensitive) names on add', () => {
    const s = make()
    const w = create(s, 'alpha')
    const added = ok(s.addColumn(w.id, '  Review  '))
    expect(added.name).toBe('Review')
    for (const bad of ['', '  ', 'backlog', 'REVIEW']) {
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
    expect(names(s.getState().workspaces[0])).toEqual(['Running', 'Backlog', 'Needs me', 'Done'])
    ok(s.moveColumn(w.id, cols[3].id, 'right'))
    ok(s.moveColumn(w.id, cols[0].id, 'left'))
    ok(s.moveColumn(w.id, cols[0].id, 'left'))
    expect(names(s.getState().workspaces[0])).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
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
    ok(s.addColumn(a.id, 'Review'))
    expect(names(s.getState().workspaces[1])).toEqual([...DEFAULT_COLUMN_NAMES])
    expect(s.addColumn(b.id, 'Review').ok).toBe(true)
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
    ok(s.addColumn(w.id, 'Review'))
    expect(s.getState()).not.toBe(before)
    expect(before.workspaces[0].columns).toHaveLength(4)
  })
})
