import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import {
  keyMoveIndex,
  nearestWorkspaceHover,
  workspaceDropIndex,
  workspaceMoveKey
} from './workspace-drops'

const list = ['alpha', 'beta', 'gamma']

describe('workspaceDropIndex (#32 D4)', () => {
  it('goes above a row in its top half and below it in its bottom half', () => {
    expect(workspaceDropIndex(list, 'gamma', { workspaceId: 'alpha', half: 'top' })).toBe(0)
    expect(workspaceDropIndex(list, 'gamma', { workspaceId: 'alpha', half: 'bottom' })).toBe(1)
    expect(workspaceDropIndex(list, 'alpha', { workspaceId: 'gamma', half: 'bottom' })).toBe(2)
    expect(workspaceDropIndex(list, 'alpha', { workspaceId: 'gamma', half: 'top' })).toBe(1)
    expect(workspaceDropIndex(list, 'alpha', { workspaceId: 'beta', half: 'top' })).toBe(0)
  })

  it('lands at the bottom below the last row', () => {
    expect(workspaceDropIndex(list, 'alpha', 'bottom')).toBe(2)
    expect(workspaceDropIndex(list, 'gamma', 'bottom')).toBe(2)
  })

  it('over the dragged row itself, keeps its place', () => {
    expect(workspaceDropIndex(list, 'beta', { workspaceId: 'beta', half: 'top' })).toBe(1)
    expect(workspaceDropIndex(list, 'beta', { workspaceId: 'beta', half: 'bottom' })).toBe(1)
  })
})

describe('nearestWorkspaceHover', () => {
  const boxes = [
    { workspaceId: 'alpha', top: 0, height: 40 },
    { workspaceId: 'beta', top: 44, height: 40 },
    { workspaceId: 'gamma', top: 88, height: 40 }
  ]

  it('picks the row under the pointer and its half', () => {
    expect(nearestWorkspaceHover(boxes, 5)).toEqual({ workspaceId: 'alpha', half: 'top' })
    expect(nearestWorkspaceHover(boxes, 70)).toEqual({ workspaceId: 'beta', half: 'bottom' })
  })

  it('in a gap, the nearest row decides; below the last row is the bottom', () => {
    expect(nearestWorkspaceHover(boxes, 43)).toEqual({ workspaceId: 'beta', half: 'top' })
    expect(nearestWorkspaceHover(boxes, 128)).toBe('bottom')
    expect(nearestWorkspaceHover([], 10)).toBe('bottom')
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

describe('workspaceMoveKey (#32 D5)', () => {
  it('maps Alt+Up and Alt+Down', () => {
    expect(workspaceMoveKey(key({ key: 'ArrowUp' }))).toBe('up')
    expect(workspaceMoveKey(key({ key: 'ArrowDown' }))).toBe('down')
  })

  it('leaves plain arrows, Enter, left and right and other modifiers alone', () => {
    expect(workspaceMoveKey(key({ altKey: false }))).toBeNull()
    expect(workspaceMoveKey(key({ key: 'Enter' }))).toBeNull()
    expect(workspaceMoveKey(key({ key: 'ArrowLeft' }))).toBeNull()
    expect(workspaceMoveKey(key({ shiftKey: true }))).toBeNull()
    expect(workspaceMoveKey(key({ ctrlKey: true }))).toBeNull()
    expect(workspaceMoveKey(key({ metaKey: true }))).toBeNull()
  })
})

describe('keyMoveIndex', () => {
  it('moves one place up or down', () => {
    expect(keyMoveIndex(list, 'beta', 'up')).toBe(0)
    expect(keyMoveIndex(list, 'beta', 'down')).toBe(2)
  })

  it('is null at the top, the bottom or for an unknown workspace', () => {
    expect(keyMoveIndex(list, 'alpha', 'up')).toBeNull()
    expect(keyMoveIndex(list, 'gamma', 'down')).toBeNull()
    expect(keyMoveIndex(list, 'nope', 'up')).toBeNull()
  })
})
