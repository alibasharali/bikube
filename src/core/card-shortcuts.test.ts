import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import { isBackShortcut } from './card-shortcuts'

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'B',
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  ...over
})

describe('isBackShortcut', () => {
  it('is Cmd+Shift+B on macOS', () => {
    expect(isBackShortcut(key({ metaKey: true }), 'darwin')).toBe(true)
    expect(isBackShortcut(key({ ctrlKey: true }), 'darwin')).toBe(false)
  })

  it('is Ctrl+Shift+B elsewhere, in either case of the key', () => {
    expect(isBackShortcut(key({ ctrlKey: true }), 'linux')).toBe(true)
    expect(isBackShortcut(key({ ctrlKey: true, key: 'b' }), 'win32')).toBe(true)
    expect(isBackShortcut(key({ metaKey: true }), 'linux')).toBe(false)
  })

  it('leaves Ctrl+B, Esc and other keys to the terminal', () => {
    expect(isBackShortcut(key({ ctrlKey: true, shiftKey: false, key: 'b' }), 'linux')).toBe(false)
    expect(isBackShortcut(key({ key: 'Escape', shiftKey: false }), 'linux')).toBe(false)
    expect(isBackShortcut(key({ ctrlKey: true, altKey: true }), 'linux')).toBe(false)
    expect(isBackShortcut(key({ ctrlKey: true, key: 'C' }), 'linux')).toBe(false)
  })
})
