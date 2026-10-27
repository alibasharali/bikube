import { describe, expect, it } from 'vitest'
import { dialogEnterAction, type DialogKey } from './dialog-keys'

const key = (over: Partial<DialogKey>): DialogKey => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  target: 'input',
  ...over
})

describe('dialogEnterAction (#69 D3)', () => {
  it('submits on Mod+Enter anywhere: Cmd on macOS, Ctrl elsewhere', () => {
    expect(dialogEnterAction(key({ metaKey: true, target: 'textarea' }), 'darwin')).toBe('submit')
    expect(dialogEnterAction(key({ ctrlKey: true, target: 'textarea' }), 'darwin')).toBeNull()
    expect(dialogEnterAction(key({ ctrlKey: true, target: 'textarea' }), 'linux')).toBe('submit')
    expect(dialogEnterAction(key({ ctrlKey: true, target: 'other' }), 'linux')).toBe('submit')
  })

  it('submits on a plain Enter in a one-line field or a select, never in the description', () => {
    expect(dialogEnterAction(key({}), 'linux')).toBe('submit')
    expect(dialogEnterAction(key({ target: 'select' }), 'linux')).toBe('submit')
    expect(dialogEnterAction(key({ target: 'textarea' }), 'linux')).toBeNull()
    expect(dialogEnterAction(key({ target: 'other' }), 'linux')).toBeNull()
    expect(dialogEnterAction(key({ shiftKey: true }), 'linux')).toBeNull()
    expect(dialogEnterAction(key({ isComposing: true }), 'linux')).toBeNull()
    expect(dialogEnterAction(key({ key: 'a' }), 'linux')).toBeNull()
  })
})
