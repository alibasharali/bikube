import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import { isBackShortcut, isSettingsShortcut, splitShortcut } from './card-shortcuts'

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

describe('splitShortcut (#11 D4)', () => {
  const d = (over: Partial<KeyLike>): KeyLike => key({ key: 'D', shiftKey: false, ...over })
  const mixes = [false, true].flatMap((metaKey) =>
    [false, true].flatMap((ctrlKey) =>
      [false, true].flatMap((shiftKey) =>
        [false, true].map((altKey) => ({ metaKey, ctrlKey, shiftKey, altKey }))
      )
    )
  )

  it('is Cmd+D right and Cmd+Shift+D down on macOS, in either case of the key', () => {
    expect(splitShortcut(d({ metaKey: true, key: 'd' }), 'darwin')).toBe('right')
    expect(splitShortcut(d({ metaKey: true, shiftKey: true }), 'darwin')).toBe('down')
    expect(splitShortcut(d({ metaKey: true, shiftKey: true, key: 'd' }), 'darwin')).toBe('down')
  })

  it('is Ctrl+Shift+D right and Ctrl+Shift+E down elsewhere', () => {
    for (const platform of ['linux', 'win32']) {
      expect(splitShortcut(d({ ctrlKey: true, shiftKey: true }), platform)).toBe('right')
      expect(splitShortcut(d({ ctrlKey: true, shiftKey: true, key: 'e' }), platform)).toBe('down')
      expect(splitShortcut(d({ ctrlKey: true, shiftKey: true, key: 'E' }), platform)).toBe('down')
    }
  })

  it('matches no other modifier mix of D or E on either platform', () => {
    const expected = (platform: string, k: string, m: (typeof mixes)[number]): string | null => {
      if (m.altKey) return null
      if (platform === 'darwin') {
        if (!m.metaKey || m.ctrlKey || k !== 'd') return null
        return m.shiftKey ? 'down' : 'right'
      }
      if (!m.ctrlKey || m.metaKey || !m.shiftKey) return null
      return k === 'd' ? 'right' : 'down'
    }
    for (const platform of ['darwin', 'linux'])
      for (const k of ['d', 'e'])
        for (const m of mixes) {
          const event = d({ ...m, key: m.shiftKey ? k.toUpperCase() : k })
          expect(splitShortcut(event, platform), `${platform} ${k} ${JSON.stringify(m)}`).toBe(
            expected(platform, k, m)
          )
        }
  })

  it('leaves plain Ctrl+D (end of input) and other keys to the terminal', () => {
    expect(splitShortcut(d({ ctrlKey: true, key: 'd' }), 'linux')).toBeNull()
    expect(splitShortcut(d({ ctrlKey: true, key: 'd' }), 'darwin')).toBeNull()
    expect(splitShortcut(d({ ctrlKey: true, shiftKey: true, key: 'F' }), 'linux')).toBeNull()
    expect(splitShortcut(d({ metaKey: true, key: 'e' }), 'darwin')).toBeNull()
  })
})
