import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import { isBackShortcut, isSettingsShortcut } from './card-shortcuts'

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

describe('isSettingsShortcut (#10 D5)', () => {
  const comma = (over: Partial<KeyLike>): KeyLike => key({ key: ',', shiftKey: false, ...over })

  it('is Cmd+, on macOS and Ctrl+, elsewhere', () => {
    expect(isSettingsShortcut(comma({ metaKey: true }), 'darwin')).toBe(true)
    expect(isSettingsShortcut(comma({ ctrlKey: true }), 'darwin')).toBe(false)
    expect(isSettingsShortcut(comma({ ctrlKey: true }), 'linux')).toBe(true)
    expect(isSettingsShortcut(comma({ ctrlKey: true }), 'win32')).toBe(true)
    expect(isSettingsShortcut(comma({ metaKey: true }), 'linux')).toBe(false)
  })

  it('leaves a plain comma and other modifiers to the terminal', () => {
    expect(isSettingsShortcut(comma({}), 'linux')).toBe(false)
    expect(isSettingsShortcut(comma({ ctrlKey: true, shiftKey: true }), 'linux')).toBe(false)
    expect(isSettingsShortcut(comma({ ctrlKey: true, altKey: true }), 'linux')).toBe(false)
    expect(isSettingsShortcut(comma({ ctrlKey: true, metaKey: true }), 'linux')).toBe(false)
    expect(isSettingsShortcut(comma({ ctrlKey: true, key: '.' }), 'linux')).toBe(false)
  })
})
