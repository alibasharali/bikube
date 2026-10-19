import { describe, expect, it } from 'vitest'
import { globalAccelerator, globalShortcutRefusal, recordGlobalPress } from './global-hotkey'
import { defaultKeymap, type KeyEventLike, type RecordResult } from './keymap'

describe('globalAccelerator (#51 D7, AC9)', () => {
  it("turns D7 text into Electron's accelerator for the OS", () => {
    expect(globalAccelerator('Ctrl+Alt+Shift+D', 'linux')).toBe('Control+Alt+Shift+D')
    expect(globalAccelerator('Cmd+Shift+Space', 'darwin')).toBe('Command+Shift+Space')
    expect(globalAccelerator('Cmd+Shift+Space', 'linux')).toBe('Super+Shift+Space')
    // As D7 orders it, too.
    expect(globalAccelerator('Shift+Cmd+Space', 'darwin')).toBe('Command+Shift+Space')
    expect(globalAccelerator('Ctrl+ArrowUp', 'linux')).toBe('Control+Up')
    expect(globalAccelerator('Alt+ArrowLeft', 'linux')).toBe('Alt+Left')
    expect(globalAccelerator('Alt+Escape', 'linux')).toBe('Alt+Esc')
    expect(globalAccelerator('Ctrl++', 'linux')).toBe('Control+Plus')
    expect(globalAccelerator('Ctrl+F5', 'linux')).toBe('Control+F5')
    expect(globalAccelerator('Ctrl+F24', 'linux')).toBe('Control+F24')
    expect(globalAccelerator('Alt+7', 'linux')).toBe('Alt+7')
    expect(globalAccelerator('Ctrl+Shift+!', 'linux')).toBe('Control+Shift+!')
    expect(globalAccelerator('Ctrl+PageDown', 'linux')).toBe('Control+PageDown')
    expect(globalAccelerator('Ctrl+Alt+Enter', 'linux')).toBe('Control+Alt+Enter')
  })

  it("has none for a key outside D7's list or text that isn't a shortcut", () => {
    expect(globalAccelerator('Ctrl+MediaPlayPause', 'linux')).toBeNull()
    expect(globalAccelerator('Ctrl+F25', 'linux')).toBeNull()
    expect(globalAccelerator('Ctrl+ContextMenu', 'linux')).toBeNull()
    expect(globalAccelerator('Ctrl+É', 'linux')).toBeNull()
    expect(globalAccelerator('Ctrl+Ctrl+D', 'linux')).toBeNull()
    expect(globalAccelerator('Hyper+D', 'linux')).toBeNull()
    expect(globalAccelerator('', 'linux')).toBeNull()
  })
})

describe('recordGlobalPress (#51 D5, AC3)', () => {
  const press = (key: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({
    type: 'keydown',
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over
  })
  const linux = defaultKeymap('linux')
  const refused = (message: string): RecordResult => ({ kind: 'refused', message })

  it('takes a key with Cmd, Ctrl or Alt that Electron can register', () => {
    expect(
      recordGlobalPress(press('D', { ctrlKey: true, altKey: true, shiftKey: true }), linux, 'linux')
    ).toEqual({ kind: 'set', shortcut: 'Ctrl+Alt+Shift+D' })
    expect(recordGlobalPress(press('Escape', { altKey: true }), linux, 'linux')).toEqual({
      kind: 'set',
      shortcut: 'Alt+Escape'
    })
  })

  it('keeps recording on a modifier alone and cancels on Escape', () => {
    expect(recordGlobalPress(press('Control', { ctrlKey: true }), linux, 'linux')).toEqual({
      kind: 'ignore'
    })
    expect(recordGlobalPress(press('Escape'), linux, 'linux')).toEqual({ kind: 'cancel' })
  })

  it('refuses a key alone, a fixed or in-app shortcut, and a key with no accelerator', () => {
    expect(recordGlobalPress(press('d', { code: 'KeyD' }), linux, 'linux')).toEqual(
      refused('Use Ctrl or Alt with a key')
    )
    expect(
      recordGlobalPress(press('P', { ctrlKey: true, shiftKey: true }), linux, 'linux')
    ).toEqual(refused('Already used by Command palette'))
    expect(
      recordGlobalPress(press('C', { ctrlKey: true, shiftKey: true }), linux, 'linux')
    ).toEqual(refused('Already used by Copy'))
    expect(recordGlobalPress(press('MediaPlayPause', { ctrlKey: true }), linux, 'linux')).toEqual(
      refused("Can't be a global shortcut")
    )
  })
})

describe('globalShortcutRefusal (#51 D9)', () => {
  const linux = defaultKeymap('linux')

  it('gives null for a free shortcut and the refusal otherwise', () => {
    expect(globalShortcutRefusal('Ctrl+Alt+Shift+D', linux, 'linux')).toBeNull()
    expect(globalShortcutRefusal('D', linux, 'linux')).toBe('Use Ctrl or Alt with a key')
    expect(globalShortcutRefusal('Shift+D', linux, 'linux')).toBe('Use Ctrl or Alt with a key')
    expect(globalShortcutRefusal('Ctrl+Shift+P', linux, 'linux')).toBe(
      'Already used by Command palette'
    )
    expect(globalShortcutRefusal('Ctrl+Q', linux, 'linux')).toBe('Already used by Quit')
    expect(globalShortcutRefusal('Ctrl+MediaPlayPause', linux, 'linux')).toBe(
      "Can't be a global shortcut"
    )
    // A changed in-app shortcut frees its default and takes its new one.
    const changed = { ...linux, palette: 'Ctrl+Alt+P' }
    expect(globalShortcutRefusal('Ctrl+Shift+P', changed, 'linux')).toBeNull()
    expect(globalShortcutRefusal('Ctrl+Alt+P', changed, 'linux')).toBe(
      'Already used by Command palette'
    )
  })
})
