import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryWorkspaceStore,
  type Workspace,
  type WorkspaceState
} from '../../core/workspace-store'

// New shell (#81 D2): always a new temporary `Terminal N`, never a Default shell.

const store = vi.hoisted(() => ({ current: null as unknown }))
const running = vi.hoisted(() => new Set<string>())

vi.mock('./store', () => ({
  get workspaceStore() {
    return store.current
  }
}))
vi.mock('./card-terminals', () => ({
  cardTerminals: () => ({
    runState: (id: string) => (running.has(id) ? { kind: 'running' } : { kind: 'stopped' }),
    onEnded: () => () => {}
  }),
  cardPanes: () => ({})
}))
vi.mock('./card-actions', () => ({ removeShell: () => {} }))

const { newShell } = await import('./temporary-shells')

const workspace: Workspace = {
  id: 'w',
  name: 'alpha',
  directory: '/tmp/alpha',
  columns: [{ id: 'c', name: 'Backlog' }],
  cards: [],
  nextCardNumber: 1,
  defaultStartup: { kind: 'shell' },
  shells: [],
  worktreeSetup: ''
}

const memory = (): InMemoryWorkspaceStore => store.current as InMemoryWorkspaceStore

beforeEach(() => {
  running.clear()
  const initialState: WorkspaceState = { workspaces: [workspace], activeId: 'w' }
  store.current = new InMemoryWorkspaceStore({ initialState })
})

describe('newShell', () => {
  it('adds Terminal 1, then Terminal 2, with no running terminal before them', () => {
    const first = newShell('w')
    const second = newShell('w')
    const shells = memory().getState().workspaces[0]!.shells
    expect(shells.map((s) => [s.id, s.name, s.temporary])).toEqual([
      [first, 'Terminal 1', true],
      [second, 'Terminal 2', true]
    ])
    expect(first).not.toMatch(/^default-shell:/)
  })

  it('opens nothing for a workspace that is gone', () => {
    expect(newShell('gone')).toBeNull()
  })
})
