import { describe, expect, it } from 'vitest'
import type { EditorFileBase } from './editor-files-types'
import {
  checkOutcome,
  isDirty,
  isSaveKey,
  replacement,
  saveChangesQuestion,
  saveFailedLine,
  statStep,
  unsavedFilesLine,
  type CheckedTab,
  type KeyPress
} from './editor-sync'

const base: EditorFileBase = { size: 4, mtimeMs: 1000, sha256: 'a'.repeat(64) }
const tab = (over: Partial<CheckedTab> = {}): CheckedTab => ({
  dirty: false,
  base,
  notice: null,
  ...over
})
const text = (sha: string, body = 'new\n') =>
  ({
    kind: 'text',
    text: body,
    eol: 'lf',
    bom: false,
    base: { size: body.length, mtimeMs: 2000, sha256: sha },
    realPath: '/p/a.ts'
  }) as const

describe('isDirty (#83 D12)', () => {
  it('compares with the text last read or saved, so undoing back cleans it', () => {
    expect(isDirty('ax', 'a')).toBe(true)
    expect(isDirty('a', 'a')).toBe(false)
  })
})

describe('statStep (#83 D13)', () => {
  it('reads again only when size or mtime changed', () => {
    expect(statStep(tab(), { kind: 'file', size: 4, mtimeMs: 1000 })).toBe('none')
    expect(statStep(tab(), { kind: 'file', size: 5, mtimeMs: 1000 })).toBe('read')
    expect(statStep(tab(), { kind: 'file', size: 4, mtimeMs: 1001 })).toBe('read')
  })
  it('notes a file gone, ignores a refusal, and reads a deleted tab whose file is back', () => {
    expect(statStep(tab(), { kind: 'missing' })).toBe('missing')
    expect(statStep(tab(), { kind: 'refused' })).toBe('none')
    expect(statStep(tab({ notice: 'deleted' }), { kind: 'file', size: 4, mtimeMs: 1000 })).toBe(
      'read'
    )
  })
})

describe('checkOutcome (#83 D13)', () => {
  it('takes the new mtime when the bytes are the same', () => {
    const read = text(base.sha256)
    expect(checkOutcome(tab({ dirty: true }), read)).toEqual({ kind: 'rebase', base: read.base })
  })
  it('reloads a clean tab silently', () => {
    const read = text('b'.repeat(64))
    expect(checkOutcome(tab(), read)).toEqual({ kind: 'reload', read })
  })
  it('shows a dirty tab the bar once per change', () => {
    const read = text('b'.repeat(64))
    expect(checkOutcome(tab({ dirty: true }), read)).toEqual({ kind: 'bar' })
    expect(checkOutcome(tab({ dirty: true, notice: 'changed' }), read)).toEqual({ kind: 'none' })
  })
  it('marks a file gone once, and does nothing on a refusal', () => {
    expect(checkOutcome(tab(), { kind: 'missing' })).toEqual({ kind: 'deleted' })
    expect(checkOutcome(tab({ notice: 'deleted' }), { kind: 'missing' })).toEqual({ kind: 'none' })
    expect(checkOutcome(tab(), { kind: 'refused' })).toEqual({ kind: 'none' })
  })
  it('reloads a clean tab whose file became binary', () => {
    const read = { kind: 'binary', realPath: '/p/a.ts' } as const
    expect(checkOutcome(tab(), read)).toEqual({ kind: 'reload', read })
  })
})

describe('replacement (#83 D13)', () => {
  it('replaces only the differing middle', () => {
    expect(replacement('one\ntwo\nthree\n', 'one\n2\nthree\n')).toEqual({
      from: 4,
      to: 7,
      insert: '2'
    })
    expect(replacement('abc', 'abcd')).toEqual({ from: 3, to: 3, insert: 'd' })
    expect(replacement('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
    expect(replacement('same', 'same')).toBeNull()
  })
  it('turns any text into the other', () => {
    for (const [a, b] of [
      ['', 'x'],
      ['x', ''],
      ['abab', 'ab'],
      ['hello world', 'help world!']
    ]) {
      const change = replacement(a, b)!
      expect(a.slice(0, change.from) + change.insert + a.slice(change.to)).toBe(b)
    }
  })
})

describe('isSaveKey (#83 D12)', () => {
  const press = (over: Partial<KeyPress>): KeyPress => ({
    key: 's',
    code: 'KeyS',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over
  })
  it('is Cmd+S on macOS and Ctrl+S elsewhere, with no other modifier', () => {
    expect(isSaveKey(press({ metaKey: true }), 'darwin')).toBe(true)
    expect(isSaveKey(press({ ctrlKey: true }), 'darwin')).toBe(false)
    expect(isSaveKey(press({ ctrlKey: true }), 'linux')).toBe(true)
    expect(isSaveKey(press({ metaKey: true }), 'linux')).toBe(false)
    expect(isSaveKey(press({ ctrlKey: true, shiftKey: true }), 'linux')).toBe(false)
    expect(isSaveKey(press({ ctrlKey: true, altKey: true }), 'linux')).toBe(false)
    expect(isSaveKey(press({ ctrlKey: true, key: 'S' }), 'linux')).toBe(true)
    expect(isSaveKey(press({ ctrlKey: true, key: 'a', code: 'KeyA' }), 'linux')).toBe(false)
  })
})

describe('lines (#83 D12)', () => {
  it('names the unsaved files a workspace delete discards', () => {
    expect(unsavedFilesLine(0)).toBeNull()
    expect(unsavedFilesLine(1)).toBe('1 unsaved file will be discarded')
    expect(unsavedFilesLine(3)).toBe('3 unsaved files will be discarded')
  })
  it('asks before closing and says why a save failed', () => {
    expect(saveChangesQuestion('a.ts')).toBe('Save changes to a.ts?')
    expect(saveFailedLine('a.ts', 'permission denied')).toBe(
      "Couldn't save a.ts: permission denied"
    )
  })
})
