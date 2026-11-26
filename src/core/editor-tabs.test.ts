import { describe, expect, it } from 'vitest'
import {
  activeTab,
  closeTab,
  closeWorkspaceTabs,
  keepWorkspaces,
  NO_TABS,
  openTab,
  refPath,
  selectTab,
  tabLabels,
  tabPath,
  workspaceTabs,
  type EditorTab
} from './editor-tabs'

const tab = (id: string): EditorTab => ({
  id,
  ref: { kind: 'folder', folder: '/repo', path: id.slice('/repo/'.length) }
})

const ids = (memory: Parameters<typeof workspaceTabs>[0], workspaceId = 'w'): string[] =>
  workspaceTabs(memory, workspaceId).tabs.map((t) => t.id)

describe('editor tabs (#83 D3)', () => {
  it('a workspace starts with no tabs', () => {
    expect(workspaceTabs(NO_TABS, 'w')).toEqual({ tabs: [], activeId: null })
    expect(activeTab(NO_TABS, 'w')).toBeNull()
  })

  it('a new tab goes right of the active one and becomes active', () => {
    let memory = openTab(NO_TABS, 'w', tab('/repo/a.ts'))
    memory = openTab(memory, 'w', tab('/repo/b.md'))
    expect(ids(memory)).toEqual(['/repo/a.ts', '/repo/b.md'])
    memory = selectTab(memory, 'w', '/repo/a.ts')
    memory = openTab(memory, 'w', tab('/repo/c.ts'))
    expect(ids(memory)).toEqual(['/repo/a.ts', '/repo/c.ts', '/repo/b.md'])
    expect(activeTab(memory, 'w')?.id).toBe('/repo/c.ts')
  })

  it('opening a file already open focuses its one tab, its reference kept', () => {
    let memory = openTab(NO_TABS, 'w', tab('/repo/a.ts'))
    memory = openTab(memory, 'w', tab('/repo/b.md'))
    memory = openTab(memory, 'w', {
      id: '/repo/a.ts',
      ref: { kind: 'listed', folder: '/repo', path: '/repo/a.ts' }
    })
    expect(ids(memory)).toEqual(['/repo/a.ts', '/repo/b.md'])
    expect(activeTab(memory, 'w')).toEqual(tab('/repo/a.ts'))
  })

  it('each workspace keeps its own tabs', () => {
    let memory = openTab(NO_TABS, 'w', tab('/repo/a.ts'))
    memory = openTab(memory, 'v', tab('/repo/b.md'))
    expect(ids(memory, 'w')).toEqual(['/repo/a.ts'])
    expect(ids(memory, 'v')).toEqual(['/repo/b.md'])
  })

  it('selecting a tab not open changes nothing', () => {
    const memory = openTab(NO_TABS, 'w', tab('/repo/a.ts'))
    expect(selectTab(memory, 'w', '/repo/x.ts')).toBe(memory)
  })

  it('closing the active tab makes its right neighbour active, else its left; the last none', () => {
    let memory = NO_TABS
    for (const id of ['/repo/a', '/repo/b', '/repo/c']) memory = openTab(memory, 'w', tab(id))
    memory = selectTab(memory, 'w', '/repo/b')
    memory = closeTab(memory, 'w', '/repo/b')
    expect(ids(memory)).toEqual(['/repo/a', '/repo/c'])
    expect(activeTab(memory, 'w')?.id).toBe('/repo/c')
    memory = closeTab(memory, 'w', '/repo/c')
    expect(activeTab(memory, 'w')?.id).toBe('/repo/a')
    memory = closeTab(memory, 'w', '/repo/a')
    expect(workspaceTabs(memory, 'w')).toEqual({ tabs: [], activeId: null })
  })

  it('closing another tab keeps the active one', () => {
    let memory = openTab(NO_TABS, 'w', tab('/repo/a'))
    memory = openTab(memory, 'w', tab('/repo/b'))
    memory = closeTab(memory, 'w', '/repo/a')
    expect(activeTab(memory, 'w')?.id).toBe('/repo/b')
  })

  it("the view's close closes every tab; a deleted workspace's tabs go", () => {
    let memory = openTab(NO_TABS, 'w', tab('/repo/a'))
    memory = openTab(memory, 'v', tab('/repo/b'))
    expect(ids(closeWorkspaceTabs(memory, 'w'))).toEqual([])
    const kept = keepWorkspaces(memory, ['v'])
    expect(ids(kept, 'w')).toEqual([])
    expect(ids(kept, 'v')).toEqual(['/repo/b'])
    expect(keepWorkspaces(memory, ['v', 'w'])).toBe(memory)
  })
})

describe('tab labels (#83 D9)', () => {
  it('a name shared by two tabs adds its parent folder', () => {
    const labels = tabLabels([
      tab('/repo/src/index.ts'),
      tab('/repo/test/index.ts'),
      tab('/repo/a.ts')
    ])
    expect(labels).toEqual([
      { name: 'index.ts', detail: 'src' },
      { name: 'index.ts', detail: 'test' },
      { name: 'a.ts', detail: null }
    ])
  })
})

describe('tab paths (#83 D4)', () => {
  it('relative to the workspace folder, else with ~ for the home, else absolute', () => {
    expect(refPath({ kind: 'folder', folder: '/repo/', path: 'src/a.ts' })).toBe('/repo/src/a.ts')
    expect(refPath({ kind: 'listed', folder: '/repo', path: '/home/u/x' })).toBe('/home/u/x')
    expect(tabPath({ kind: 'folder', folder: '/repo', path: 'src/a.ts' }, '/repo', '/home/u')).toBe(
      'src/a.ts'
    )
    // A worktree card's folder outside the workspace's.
    expect(
      tabPath({ kind: 'folder', folder: '/home/u/wt', path: 'a.ts' }, '/repo/', '/home/u')
    ).toBe('~/wt/a.ts')
    expect(
      tabPath({ kind: 'listed', folder: '/repo', path: '/etc/hosts' }, '/repo', '/home/u')
    ).toBe('/etc/hosts')
  })
})
