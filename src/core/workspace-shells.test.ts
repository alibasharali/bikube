import { describe, expect, it } from 'vitest'
import { findShellCard, shellCards } from './workspace-shells'
import { defaultShellId, type Workspace } from './workspace-store'

const workspace: Workspace = {
  id: 'w',
  name: 'alpha',
  directory: '/tmp/alpha',
  columns: [{ id: 'c', name: 'Backlog' }],
  cards: [],
  nextCardNumber: 1,
  defaultStartup: { kind: 'claude' },
  shells: [{ id: 's1', name: 'Dev server', command: 'npm run dev', autostart: true }]
}

describe('workspace shells as cards', () => {
  it('puts the Default shell first, plain, then each shell typing its command', () => {
    expect(shellCards(workspace).map((c) => [c.id, c.title, c.startup])).toEqual([
      [defaultShellId('w'), 'Default', { kind: 'shell' }],
      ['s1', 'Dev server', { kind: 'custom', command: 'npm run dev' }]
    ])
    expect(shellCards(workspace)[0]).toMatchObject({ directory: '/tmp/alpha' })
  })

  it('runs over SSH in an SSH workspace', () => {
    const remote = { ...workspace, host: 'devbox', directory: '~/api' }
    expect(shellCards(remote).every((c) => c.host === 'devbox' && c.directory === '~/api')).toBe(
      true
    )
  })

  it('finds a shell by id, the Default one included', () => {
    expect(findShellCard(workspace, 's1')?.title).toBe('Dev server')
    expect(findShellCard(workspace, defaultShellId('w'))?.title).toBe('Default')
    expect(findShellCard(workspace, 'nope')).toBeUndefined()
  })
})
