import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import { isShiftEnter, SHIFT_ENTER } from './terminal-keys'

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  ...over
})

describe('isShiftEnter', () => {
  it('takes Shift+Enter on keydown, keypress and keyup', () => {
    for (const type of ['keydown', 'keypress', 'keyup'])
      expect(isShiftEnter(key({ type }))).toBe(true)
  })

  it('leaves plain Enter and Enter with any other modifier alone', () => {
    expect(isShiftEnter(key({ shiftKey: false }))).toBe(false)
    expect(isShiftEnter(key({ altKey: true }))).toBe(false)
    expect(isShiftEnter(key({ ctrlKey: true }))).toBe(false)
    expect(isShiftEnter(key({ metaKey: true }))).toBe(false)
    expect(isShiftEnter(key({ key: 'a' }))).toBe(false)
  })

  it('sends ESC CR', () => {
    expect(SHIFT_ENTER).toBe('\u001b\r')
  })
})
