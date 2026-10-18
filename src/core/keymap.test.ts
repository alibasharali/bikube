import { describe, expect, it } from 'vitest'
import {
  defaultKeymap,
  fixedShortcuts,
  keymapAction,
  readShortcuts,
  recordPress,
  resetRefusal,
  resolveKeymap,
  shortcutOverrides,
  validateShortcuts,
  workspaceShortcut,
  SHORTCUT_LABELS,
  type KeyEventLike
} from './keymap'

const press = (key: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({
  type: 'keydown',
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over
})

describe('defaultKeymap (#31 D6)', () => {
  it('gives each OS its defaults', () => {
    expect(defaultKeymap('darwin')).toEqual({
      back: 'Shift+Cmd+B',
      splitRight: 'Cmd+D',
      splitDown: 'Shift+Cmd+D',
      closePane: 'Cmd+W',
      closeCard: 'Shift+Cmd+W',
      settings: 'Cmd+,',
      openShell: 'Cmd+T',
      togglePanel: 'Alt+Cmd+B'
    })
    for (const platform of ['linux', 'win32']) {
      expect(defaultKeymap(platform)).toEqual({
        back: 'Ctrl+Shift+B',
        splitRight: 'Ctrl+Shift+D',
        splitDown: 'Ctrl+Shift+E',
        closePane: 'Ctrl+Shift+W',
        closeCard: 'Ctrl+Shift+Q',
        settings: 'Ctrl+,',
        openShell: 'Ctrl+Shift+T',
        togglePanel: 'Ctrl+Alt+B'
      })
    }
  })
})

describe('Toggle panel (#55 D2, AC3)', () => {
  it('is a configurable action named Toggle panel, matched with focus anywhere', () => {
    expect(SHORTCUT_LABELS.togglePanel).toBe('Toggle panel')
    expect(keymapAction(press('b', { ctrlKey: true, altKey: true }), defaultKeymap('linux'))).toBe(
      'togglePanel'
    )
    expect(keymapAction(press('B', { metaKey: true, altKey: true }), defaultKeymap('darwin'))).toBe(
      'togglePanel'
    )
    expect(fixedShortcuts('linux').has('Ctrl+Alt+B')).toBe(false)
    expect(fixedShortcuts('darwin').has('Alt+Cmd+B')).toBe(false)
  })

  it('can be recorded as another key, which replaces the default', () => {
    const keymap = defaultKeymap('linux')
    expect(
      recordPress(press('p', { ctrlKey: true, altKey: true }), 'togglePanel', keymap, 'linux')
    ).toEqual({ kind: 'set', shortcut: 'Ctrl+Alt+P' })
    const next = resolveKeymap({ togglePanel: 'Ctrl+Alt+P' }, 'linux')
    expect(keymapAction(press('b', { ctrlKey: true, altKey: true }), next)).toBeNull()
    expect(keymapAction(press('p', { ctrlKey: true, altKey: true }), next)).toBe('togglePanel')
    expect(readShortcuts({ togglePanel: 'Ctrl+Alt+P' }, 'linux').shortcuts).toEqual({
      togglePanel: 'Ctrl+Alt+P'
    })
  })
})

describe('keymapAction (#31 D7, AC3)', () => {
  const linux = defaultKeymap('linux')
  const mac = defaultKeymap('darwin')

  it('finds the action of an exact press, the key in either case, on every event type', () => {
    expect(keymapAction(press('D', { ctrlKey: true, shiftKey: true }), linux)).toBe('splitRight')
    expect(keymapAction(press('e', { ctrlKey: true, shiftKey: true }), linux)).toBe('splitDown')
    expect(keymapAction(press('W', { ctrlKey: true, shiftKey: true }), linux)).toBe('closePane')
    expect(keymapAction(press('Q', { ctrlKey: true, shiftKey: true }), linux)).toBe('closeCard')
    expect(keymapAction(press(',', { ctrlKey: true, type: 'keyup' }), linux)).toBe('settings')
    expect(keymapAction(press('d', { metaKey: true }), mac)).toBe('splitRight')
    expect(keymapAction(press('w', { metaKey: true }), mac)).toBe('closePane')
    expect(keymapAction(press('W', { metaKey: true, shiftKey: true }), mac)).toBe('closeCard')
  })

  it('needs every listed modifier and no other, Shift included', () => {
    expect(keymapAction(press('d', { ctrlKey: true }), linux)).toBeNull()
    expect(keymapAction(press('w', { ctrlKey: true }), linux)).toBeNull()
    expect(
      keymapAction(press('D', { ctrlKey: true, shiftKey: true, altKey: true }), linux)
    ).toBeNull()
    expect(
      keymapAction(press('D', { ctrlKey: true, shiftKey: true, metaKey: true }), linux)
    ).toBeNull()
    expect(keymapAction(press('D', { metaKey: true, shiftKey: true }), linux)).toBeNull()
    expect(keymapAction(press('D', { metaKey: true, shiftKey: true }), mac)).toBe('splitDown')
    expect(keymapAction(press(',', { ctrlKey: true, shiftKey: true }), linux)).toBeNull()
    expect(keymapAction(press('F', { ctrlKey: true, shiftKey: true }), linux)).toBeNull()
  })

  it('reads a letter from the physical key when the layout gives another character', () => {
    // macOS Option+R types ®; Ctrl+Alt+R still is that shortcut.
    const keymap = { ...linux, splitRight: 'Ctrl+Alt+R' }
    const optionR = press('®', { code: 'KeyR', ctrlKey: true, altKey: true })
    expect(keymapAction(optionR, keymap)).toBe('splitRight')
    expect(keymapAction(press('r', { code: 'KeyR', ctrlKey: true, altKey: true }), keymap)).toBe(
      'splitRight'
    )
    // A non-Latin layout's letter is read from the physical key too.
    const ctrlB = press('и', { code: 'KeyB', ctrlKey: true, shiftKey: true })
    expect(keymapAction(ctrlB, linux)).toBe('back')
  })

  it("keeps a typed ASCII character over the physical key (AZERTY's , on the M key)", () => {
    const azertyComma = press(',', { code: 'KeyM', ctrlKey: true })
    expect(keymapAction(azertyComma, linux)).toBe('settings')
    expect(keymapAction(press(',', { code: 'KeyM', metaKey: true }), defaultKeymap('darwin'))).toBe(
      'settings'
    )
    expect(keymapAction(press('m', { code: 'KeyM', ctrlKey: true }), linux)).toBeNull()
  })
})

describe('recordPress (#31 D8, AC7)', () => {
  const linux = defaultKeymap('linux')
  const mac = defaultKeymap('darwin')
  const record = (event: KeyEventLike, platform = 'linux'): ReturnType<typeof recordPress> =>
    recordPress(event, 'splitRight', platform === 'darwin' ? mac : linux, platform)
  const refused = (message: string): ReturnType<typeof recordPress> => ({
    kind: 'refused',
    message
  })

  it('takes a key with Cmd, Ctrl or Alt as the new shortcut', () => {
    expect(record(press('r', { code: 'KeyR', ctrlKey: true, altKey: true }))).toEqual({
      kind: 'set',
      shortcut: 'Ctrl+Alt+R'
    })
    expect(record(press('F5', { altKey: true }))).toEqual({ kind: 'set', shortcut: 'Alt+F5' })
    expect(record(press('k', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({
      kind: 'set',
      shortcut: 'Shift+Cmd+K'
    })
    // Its own current shortcut is no conflict.
    expect(record(press('D', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'set',
      shortcut: 'Ctrl+Shift+D'
    })
  })

  it('keeps recording on a modifier alone and cancels on Escape', () => {
    expect(record(press('Control', { ctrlKey: true }))).toEqual({ kind: 'ignore' })
    expect(record(press('Shift', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'ignore' })
    expect(record(press('Escape'))).toEqual({ kind: 'cancel' })
  })

  it('asks for a modifier on a key without Cmd, Ctrl or Alt', () => {
    expect(record(press('r'))).toEqual(refused('Use Ctrl or Alt with a key'))
    expect(record(press('R', { shiftKey: true }))).toEqual(refused('Use Ctrl or Alt with a key'))
    expect(record(press('r'), 'darwin')).toEqual(refused('Use Cmd or Alt with a key'))
  })

  it("refuses another action's current shortcut", () => {
    expect(record(press('B', { ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Back to board')
    )
    expect(record(press('W', { ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Close pane')
    )
    expect(record(press(',', { metaKey: true }), 'darwin')).toEqual(
      refused('Already used by Open Settings')
    )
    const changed = { ...linux, closeCard: 'Ctrl+Alt+K' }
    expect(
      recordPress(press('k', { ctrlKey: true, altKey: true }), 'back', changed, 'linux')
    ).toEqual(refused('Already used by Close card'))
  })

  it('refuses the fixed shortcuts of each OS', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(record(press(key, { altKey: true }))).toEqual(refused('Already used by Move card'))
      expect(record(press(key, { altKey: true }), 'darwin')).toEqual(
        refused('Already used by Move card')
      )
    }
    expect(record(press('C', { ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Copy')
    )
    expect(record(press('V', { ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Paste')
    )
    expect(record(press('c', { metaKey: true }), 'darwin')).toEqual(refused('Already used by Copy'))
    expect(record(press('v', { metaKey: true }), 'darwin')).toEqual(
      refused('Already used by Paste')
    )
    for (let digit = 1; digit <= 9; digit++) {
      const code = `Digit${digit}`
      expect(record(press(String(digit), { code, ctrlKey: true }))).toEqual(
        refused('Already used by Switch workspace')
      )
      expect(record(press(String(digit), { code, metaKey: true }), 'darwin')).toEqual(
        refused('Already used by Switch workspace')
      )
    }
    expect(record(press('q', { metaKey: true }), 'darwin')).toEqual(refused('Already used by Quit'))
    expect(record(press('h', { metaKey: true }), 'darwin')).toEqual(refused('Already used by Hide'))
    expect(record(press('m', { metaKey: true }), 'darwin')).toEqual(
      refused('Already used by Minimize')
    )
  })

  it("refuses the app menu's accelerators on this OS (round 4 Q3)", () => {
    expect(record(press('r', { ctrlKey: true }))).toEqual(refused('Already used by Reload'))
    expect(record(press('w', { ctrlKey: true }))).toEqual(refused('Already used by Close Window'))
    expect(record(press('c', { ctrlKey: true }))).toEqual(refused('Already used by Copy'))
    expect(record(press('q', { ctrlKey: true }))).toEqual(refused('Already used by Quit'))
    expect(record(press('0', { code: 'Digit0', ctrlKey: true }))).toEqual(
      refused('Already used by Actual Size')
    )
    expect(record(press('+', { code: 'Equal', ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Zoom In')
    )
    expect(record(press('-', { code: 'Minus', ctrlKey: true }))).toEqual(
      refused('Already used by Zoom Out')
    )
    expect(record(press('I', { ctrlKey: true, shiftKey: true }))).toEqual(
      refused('Already used by Toggle Developer Tools')
    )
    expect(record(press('z', { metaKey: true }), 'darwin')).toEqual(refused('Already used by Undo'))
    expect(record(press('r', { metaKey: true }), 'darwin')).toEqual(
      refused('Already used by Reload')
    )
    expect(record(press('a', { metaKey: true }), 'darwin')).toEqual(
      refused('Already used by Select All')
    )
  })

  it('never makes a default shortcut fixed', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      const fixed = fixedShortcuts(platform)
      for (const shortcut of Object.values(defaultKeymap(platform))) {
        expect(fixed.has(shortcut)).toBe(false)
      }
    }
  })

  it("leaves the other OS's fixed shortcuts and other modifier mixes free", () => {
    expect(record(press('c', { metaKey: true }))).toEqual({ kind: 'set', shortcut: 'Cmd+C' })
    expect(record(press('w', { ctrlKey: true }), 'darwin')).toEqual({
      kind: 'set',
      shortcut: 'Ctrl+W'
    })
    expect(record(press('!', { code: 'Digit1', ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'set',
      shortcut: 'Ctrl+Shift+!'
    })
    expect(record(press('ArrowUp', { altKey: true, shiftKey: true }))).toEqual({
      kind: 'set',
      shortcut: 'Alt+Shift+ArrowUp'
    })
  })
})

describe('readShortcuts (#31 D9, AC8)', () => {
  it('keeps valid entries that differ from the default; the rest fall back', () => {
    expect(
      readShortcuts(
        { back: 'B', splitRight: 'Ctrl+Alt+R', closePane: 'Ctrl+Alt+R', bogus: 'Ctrl+K' },
        'linux'
      )
    ).toEqual({ shortcuts: {}, dropped: ['back', 'splitRight', 'closePane'] })
    expect(readShortcuts({ splitRight: 'Ctrl+Alt+R', closeCard: 'Ctrl+Shift+Q' }, 'linux')).toEqual(
      { shortcuts: { splitRight: 'Ctrl+Alt+R' }, dropped: [] }
    )
  })

  it('drops malformed, modifier-less and non-text entries one by one', () => {
    const raw = {
      back: 'Shift+Ctrl+B',
      splitRight: 'ctrl+shift+x',
      splitDown: 'Shift+X',
      closePane: 42,
      closeCard: 'Ctrl+Alt+Ctrl+K',
      settings: 'Alt+F5'
    }
    expect(readShortcuts(raw, 'linux')).toEqual({
      shortcuts: { settings: 'Alt+F5' },
      dropped: ['back', 'splitRight', 'splitDown', 'closePane', 'closeCard']
    })
  })

  it("lets an entry that takes another action's default fall back with it", () => {
    // Split right takes Back's default: both share it, so Split right falls back.
    expect(readShortcuts({ splitRight: 'Ctrl+Shift+B' }, 'linux')).toEqual({
      shortcuts: {},
      dropped: ['splitRight']
    })
    // Back moves away, so Split right may take its default.
    expect(readShortcuts({ back: 'Ctrl+Alt+K', splitRight: 'Ctrl+Shift+B' }, 'linux')).toEqual({
      shortcuts: { back: 'Ctrl+Alt+K', splitRight: 'Ctrl+Shift+B' },
      dropped: []
    })
  })

  it('drops a fixed shortcut: copy, a menu accelerator, workspace switching (round 4 Q4)', () => {
    const raw = {
      splitRight: 'Ctrl+Shift+C',
      closeCard: 'Ctrl+R',
      back: 'Ctrl+1',
      settings: 'Alt+F5'
    }
    expect(readShortcuts(raw, 'linux')).toEqual({
      shortcuts: { settings: 'Alt+F5' },
      dropped: ['back', 'splitRight', 'closeCard']
    })
    // Fixed only on its own OS.
    expect(readShortcuts({ splitRight: 'Ctrl+Shift+C' }, 'darwin')).toEqual({
      shortcuts: { splitRight: 'Ctrl+Shift+C' },
      dropped: []
    })
  })

  it('reads anything but an object as all defaults', () => {
    for (const raw of [undefined, null, 'Ctrl+K', ['Ctrl+K']]) {
      expect(readShortcuts(raw, 'linux')).toEqual({ shortcuts: {}, dropped: [] })
    }
  })
})

describe('validateShortcuts (#31 D9)', () => {
  it('keeps a valid set, without the entries equal to the default', () => {
    expect(validateShortcuts({ splitRight: 'Ctrl+Alt+R', back: 'Ctrl+Shift+B' }, 'linux')).toEqual({
      splitRight: 'Ctrl+Alt+R'
    })
    expect(validateShortcuts({}, 'linux')).toEqual({})
    expect(validateShortcuts(undefined, 'linux')).toEqual({})
  })

  it('rejects the whole set for one bad entry or a shared shortcut', () => {
    expect(validateShortcuts({ splitRight: 'Ctrl+Alt+R', back: 'B' }, 'linux')).toBeNull()
    expect(validateShortcuts({ splitRight: 'Ctrl+Alt+R', bogus: 'Ctrl+K' }, 'linux')).toBeNull()
    expect(validateShortcuts({ splitRight: 'Ctrl+Shift+B' }, 'linux')).toBeNull()
    expect(
      validateShortcuts({ splitRight: 'Ctrl+Alt+R', closePane: 'Ctrl+Alt+R' }, 'linux')
    ).toBeNull()
    expect(validateShortcuts('Ctrl+K', 'linux')).toBeNull()
    expect(validateShortcuts({ splitRight: 'Ctrl+Shift+C' }, 'linux')).toBeNull()
    expect(validateShortcuts({ closeCard: 'Ctrl+R' }, 'linux')).toBeNull()
  })
})

describe('resolveKeymap and shortcutOverrides', () => {
  it('lays the overrides over the defaults, and back', () => {
    const keymap = resolveKeymap({ splitRight: 'Ctrl+Alt+R' }, 'linux')
    expect(keymap).toEqual({ ...defaultKeymap('linux'), splitRight: 'Ctrl+Alt+R' })
    expect(resolveKeymap(undefined, 'darwin')).toEqual(defaultKeymap('darwin'))
    expect(shortcutOverrides(keymap, 'linux')).toEqual({ splitRight: 'Ctrl+Alt+R' })
    expect(shortcutOverrides(defaultKeymap('linux'), 'linux')).toEqual({})
  })
})

describe('the default split shortcuts against every modifier mix (#11 D4)', () => {
  const mixes = [false, true].flatMap((metaKey) =>
    [false, true].flatMap((ctrlKey) =>
      [false, true].flatMap((shiftKey) =>
        [false, true].map((altKey) => ({ metaKey, ctrlKey, shiftKey, altKey }))
      )
    )
  )

  it('matches only Cmd+D / Shift+Cmd+D on macOS and Ctrl+Shift+D / Ctrl+Shift+E elsewhere', () => {
    const expected = (platform: string, k: string, m: (typeof mixes)[number]): string | null => {
      if (m.altKey) return null
      if (platform === 'darwin') {
        if (!m.metaKey || m.ctrlKey || k !== 'd') return null
        return m.shiftKey ? 'splitDown' : 'splitRight'
      }
      if (!m.ctrlKey || m.metaKey || !m.shiftKey) return null
      return k === 'd' ? 'splitRight' : 'splitDown'
    }
    for (const platform of ['darwin', 'linux'])
      for (const k of ['d', 'e'])
        for (const m of mixes) {
          const event = press(m.shiftKey ? k.toUpperCase() : k, m)
          expect(
            keymapAction(event, defaultKeymap(platform)),
            `${platform} ${k} ${JSON.stringify(m)}`
          ).toBe(expected(platform, k, m))
        }
  })

  it('leaves Escape, plain Ctrl+D, Ctrl+B and Ctrl+C to the terminal', () => {
    const linux = defaultKeymap('linux')
    expect(keymapAction(press('Escape'), linux)).toBeNull()
    expect(keymapAction(press('d', { ctrlKey: true }), linux)).toBeNull()
    expect(keymapAction(press('b', { ctrlKey: true }), linux)).toBeNull()
    expect(keymapAction(press('c', { ctrlKey: true }), linux)).toBeNull()
    expect(keymapAction(press('d', { ctrlKey: true }), defaultKeymap('darwin'))).toBeNull()
  })
})

describe('workspaceShortcut (#31 D18, AC16)', () => {
  const digit = (n: number, over: Partial<KeyEventLike> = {}): KeyEventLike =>
    press(String(n), { code: `Digit${n}`, ...over })

  it('reads Ctrl+1…9 off macOS and Cmd+1…9 on macOS as the workspace number', () => {
    for (let n = 1; n <= 9; n++) {
      expect(workspaceShortcut(digit(n, { ctrlKey: true }), 'linux')).toBe(n)
      expect(workspaceShortcut(digit(n, { metaKey: true }), 'darwin')).toBe(n)
    }
    expect(workspaceShortcut(digit(1, { metaKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(digit(1, { ctrlKey: true }), 'darwin')).toBeNull()
  })

  it('matches the physical digit key, whatever character the layout types', () => {
    // AZERTY: the 2 key types é without Shift.
    expect(workspaceShortcut(press('é', { code: 'Digit2', ctrlKey: true }), 'linux')).toBe(2)
    expect(workspaceShortcut(press('2', { code: 'Numpad2', ctrlKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(press('2', { ctrlKey: true }), 'linux')).toBeNull()
  })

  it('needs no other modifier and no 0 or other key', () => {
    expect(workspaceShortcut(digit(2), 'linux')).toBeNull()
    expect(workspaceShortcut(digit(2, { ctrlKey: true, shiftKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(digit(2, { ctrlKey: true, altKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(digit(2, { ctrlKey: true, metaKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(digit(2, { metaKey: true, ctrlKey: true }), 'darwin')).toBeNull()
    expect(workspaceShortcut(digit(0, { ctrlKey: true }), 'linux')).toBeNull()
    expect(workspaceShortcut(press('a', { code: 'KeyA', ctrlKey: true }), 'linux')).toBeNull()
  })

  it('matches every event type, so the whole key is swallowed', () => {
    expect(workspaceShortcut(digit(3, { ctrlKey: true, type: 'keyup' }), 'linux')).toBe(3)
  })
})

describe('resetRefusal (#31 D8)', () => {
  it('refuses a default another action holds now, naming that action', () => {
    // Close card moved away, then Split right took Close card's default.
    const keymap = {
      ...defaultKeymap('linux'),
      closeCard: 'Ctrl+Alt+X',
      splitRight: 'Ctrl+Shift+Q'
    }
    expect(resetRefusal('closeCard', keymap, 'linux')).toBe('Already used by Split right')
    // Split right's own default is free again, so its Reset may apply.
    expect(resetRefusal('splitRight', keymap, 'linux')).toBeNull()
  })

  it('lets Reset apply a default nobody else holds', () => {
    const keymap = { ...defaultKeymap('darwin'), back: 'Cmd+Alt+B' }
    expect(resetRefusal('back', keymap, 'darwin')).toBeNull()
  })
})
