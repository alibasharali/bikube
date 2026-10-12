import { describe, expect, it } from 'vitest'
import { workspaceInitial } from './workspace-initial'

describe('workspaceInitial', () => {
  it('uppercases the first character', () => {
    expect(workspaceInitial('alpha')).toBe('A')
  })
  it('skips leading whitespace and punctuation', () => {
    expect(workspaceInitial('  _-beta')).toBe('B')
  })
  it('keeps a whole emoji or astral character', () => {
    expect(workspaceInitial('🚀 launch')).toBe('🚀')
  })
  it('falls back to ? for empty names', () => {
    expect(workspaceInitial('   ')).toBe('?')
  })
})
