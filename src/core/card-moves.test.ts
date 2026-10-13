import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import { cardMoveKey, keyMoveTarget } from './card-moves'
import type { Workspace } from './workspace-store'

const ws = (cards: Record<string, string[]>): Workspace => {
  const columnIds = ['backlog', 'running', 'needs', 'done']
  return {
    id: 'w',
    name: 'alpha',
    directory: '/tmp/alpha',
    columns: columnIds.map((id) => ({ id, name: id })),
    cards: columnIds.flatMap((columnId) =>
      (cards[columnId] ?? []).map((id) => ({
        id,
        columnId,
        title: id,
        directory: '/tmp/alpha',
        startup: { kind: 'shell' as const },
        agentSessionId: 'x',
        claudeStarted: false
      }))
    ),
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' }
  }
}

describe('keyMoveTarget', () => {
  it('moves up and down one place within the column', () => {
    const w = ws({ backlog: ['a', 'b', 'c'] })
    expect(keyMoveTarget(w, 'b', 'up')).toEqual({ columnId: 'backlog', index: 0 })
    expect(keyMoveTarget(w, 'b', 'down')).toEqual({ columnId: 'backlog', index: 2 })
    expect(keyMoveTarget(w, 'a', 'down')).toEqual({ columnId: 'backlog', index: 1 })
  })

  it('does nothing at the top or bottom of the column', () => {
    const w = ws({ backlog: ['a', 'b'] })
    expect(keyMoveTarget(w, 'a', 'up')).toBeNull()
    expect(keyMoveTarget(w, 'b', 'down')).toBeNull()
    expect(keyMoveTarget(ws({ backlog: ['a'] }), 'a', 'up')).toBeNull()
  })

  it('moves to the bottom of the previous or next column', () => {
    const w = ws({ backlog: ['a'], running: ['x', 'b', 'y'], needs: ['n'] })
    expect(keyMoveTarget(w, 'b', 'left')).toEqual({ columnId: 'backlog', index: 1 })
    expect(keyMoveTarget(w, 'b', 'right')).toEqual({ columnId: 'needs', index: 1 })
    expect(keyMoveTarget(w, 'a', 'right')).toEqual({ columnId: 'running', index: 3 })
    expect(keyMoveTarget(w, 'n', 'right')).toEqual({ columnId: 'done', index: 0 })
  })

  it('does nothing past the first or last column', () => {
    const w = ws({ backlog: ['a'], done: ['d'] })
    expect(keyMoveTarget(w, 'a', 'left')).toBeNull()
    expect(keyMoveTarget(w, 'd', 'right')).toBeNull()
  })

  it('does nothing for an unknown card', () => {
    expect(keyMoveTarget(ws({ backlog: ['a'] }), 'nope', 'down')).toBeNull()
  })
})

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'ArrowUp',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: true,
  ...over
})

describe('cardMoveKey', () => {
  it('maps Alt+arrows to directions', () => {
    expect(cardMoveKey(key({ key: 'ArrowUp' }))).toBe('up')
    expect(cardMoveKey(key({ key: 'ArrowDown' }))).toBe('down')
    expect(cardMoveKey(key({ key: 'ArrowLeft' }))).toBe('left')
    expect(cardMoveKey(key({ key: 'ArrowRight' }))).toBe('right')
  })

  it('leaves plain arrows, Enter and other modifiers alone', () => {
    expect(cardMoveKey(key({ altKey: false }))).toBeNull()
    expect(cardMoveKey(key({ key: 'Enter' }))).toBeNull()
    expect(cardMoveKey(key({ shiftKey: true }))).toBeNull()
    expect(cardMoveKey(key({ ctrlKey: true }))).toBeNull()
    expect(cardMoveKey(key({ metaKey: true }))).toBeNull()
  })
})
