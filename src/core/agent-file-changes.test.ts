import { describe, expect, it } from 'vitest'
import {
  commandFileChanges,
  diffCount,
  joinPath,
  lineCount,
  patchCount
} from './agent-file-changes'

describe("What changed's sizes and commands (#75 D9)", () => {
  it('counts lines, a diff without its common lines, and a structured patch', () => {
    expect([lineCount(''), lineCount('a'), lineCount('a\nb\n')]).toEqual([0, 1, 2])
    expect(diffCount('a\nb\nc', 'a\nX\nY\nc')).toEqual({ added: 2, removed: 1 })
    expect(patchCount([{ lines: [' a', '-b', '+c', '+d'] }])).toEqual({ added: 2, removed: 1 })
    expect(patchCount('nope')).toBeNull()
  })

  it('resolves paths against the working directory, keeping a relative one relative', () => {
    expect(joinPath('/repo', '../x/./y')).toBe('/x/y')
    expect(joinPath(null, 'a/../b')).toBe('b')
    expect(joinPath('/repo', '/abs')).toBe('/abs')
  })

  it('moves into a folder named with a trailing slash, and stops at a cd it cannot follow', () => {
    expect(commandFileChanges('git mv -f a.ts lib/', '/r')).toEqual([
      { kind: 'rename', path: '/r/a.ts', to: '/r/lib/a.ts' }
    ])
    expect(commandFileChanges('cd "$DIR" && rm a', '/r')).toEqual([])
    expect(commandFileChanges('rm -- -weird', '/r')).toEqual([])
  })
})
