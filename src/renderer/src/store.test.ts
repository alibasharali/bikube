import { describe, expect, it } from 'vitest'
import type { WorkspaceState } from '../../core/workspace-store'
import { createWorkspaceStore } from './store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const saved: WorkspaceState = {
  workspaces: [
    {
      id: 'w-saved',
      name: 'alpha',
      directory: '/tmp/drovr-alpha',
      columns: [{ id: 'c-saved', name: 'Todo' }],
      cards: [
        {
          id: 'k-saved',
          columnId: 'c-saved',
          title: 'Terminal 1',
          directory: '/tmp/drovr-alpha',
          startup: { kind: 'shell' },
          agentSessionId: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11',
          claudeStarted: false,
          startedAgents: []
        }
      ],
      nextCardNumber: 2,
      defaultStartup: { kind: 'claude' },
      shells: []
    }
  ],
  activeId: 'w-saved'
}

describe('createWorkspaceStore (#8 D5, D6, D8)', () => {
  it('starts from the loaded state', () => {
    const store = createWorkspaceStore(saved, () => {})
    expect(store.getState()).toBe(saved)
  })

  it('sends the whole state to save on every change', () => {
    const sent: WorkspaceState[] = []
    const store = createWorkspaceStore(saved, (state) => sent.push(state))
    store.renameCard('w-saved', 'k-saved', 'api')
    store.addColumn('w-saved', 'Doing')
    expect(sent).toHaveLength(2)
    expect(sent[1]).toBe(store.getState())
    expect(sent[1].workspaces[0].cards[0].title).toBe('api')
  })

  it('gives new workspaces, columns and cards UUIDs and keeps restored ids', () => {
    const store = createWorkspaceStore(saved, () => {})
    const column = store.addColumn('w-saved', 'Doing')
    const card = store.createCard('w-saved', 'c-saved', '')
    const workspace = store.createWorkspace({ name: 'beta', directory: '/tmp/drovr-beta' })
    expect(column.ok && column.value.id).toMatch(UUID)
    expect(card.ok && card.value.id).toMatch(UUID)
    expect(card.ok && card.value.title).toBe('Terminal 2')
    expect(workspace.ok && workspace.value.id).toMatch(UUID)
    if (workspace.ok) workspace.value.columns.forEach((c) => expect(c.id).toMatch(UUID))
    const alpha = store.getState().workspaces[0]
    expect(alpha.id).toBe('w-saved')
    expect(alpha.cards[0].id).toBe('k-saved')
  })
})
