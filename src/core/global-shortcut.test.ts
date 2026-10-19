import { describe, expect, it } from 'vitest'
import {
  GlobalShortcut,
  globalPressAction,
  withFeature,
  type GlobalShortcutOs
} from './global-shortcut'

describe('globalPressAction (#51 D3)', () => {
  const front = { visible: true, minimized: false, focused: true }

  it('hides a focused window: the app on macOS, minimized elsewhere', () => {
    expect(globalPressAction(front, 'darwin')).toBe('hide')
    expect(globalPressAction(front, 'linux')).toBe('minimize')
    expect(globalPressAction(front, 'win32')).toBe('minimize')
  })

  it('brings forward a window that is behind, minimized or hidden', () => {
    expect(globalPressAction({ ...front, focused: false }, 'linux')).toBe('show')
    expect(globalPressAction({ ...front, minimized: true }, 'linux')).toBe('show')
    expect(globalPressAction({ ...front, visible: false }, 'darwin')).toBe('show')
    expect(globalPressAction({ visible: false, minimized: true, focused: false }, 'linux')).toBe(
      'show'
    )
  })

  it('creates a window when there is none', () => {
    expect(globalPressAction(null, 'darwin')).toBe('create')
  })
})

/** A fake OS: what is registered, every register asked, and accelerators it refuses. */
function fakeOs(refuse: string[] = []): GlobalShortcutOs & {
  registered: Map<string, () => void>
  asked: string[]
  refuse: string[]
} {
  const registered = new Map<string, () => void>()
  const asked: string[] = []
  return {
    registered,
    asked,
    refuse,
    register(accelerator: string, onPress: () => void): boolean {
      asked.push(accelerator)
      if (refuse.includes(accelerator) || registered.has(accelerator)) return false
      registered.set(accelerator, onPress)
      return true
    },
    unregister(accelerator: string): void {
      registered.delete(accelerator)
    }
  }
}

describe('GlobalShortcut (#51 D2, D6, D8)', () => {
  it('registers the saved shortcut as an accelerator and calls back on its press', () => {
    const os = fakeOs()
    let pressed = 0
    const shortcut = new GlobalShortcut(os, 'linux', () => pressed++)
    expect(shortcut.state()).toBe('none')
    shortcut.set('Ctrl+Alt+Shift+D')
    expect([...os.registered.keys()]).toEqual(['Control+Alt+Shift+D'])
    expect(shortcut.state()).toBe('registered')
    os.registered.get('Control+Alt+Shift+D')!()
    expect(pressed).toBe(1)
  })

  it('registers nothing for none or text with no accelerator', () => {
    const os = fakeOs()
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set(undefined)
    shortcut.set('Ctrl+MediaPlayPause')
    expect(os.asked).toEqual([])
    expect(shortcut.state()).toBe('none')
  })

  it('swaps the old one for a new one, and clearing unregisters it at once', () => {
    const os = fakeOs()
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    shortcut.set('Ctrl+Alt+K')
    expect([...os.registered.keys()]).toEqual(['Control+Alt+K'])
    shortcut.set(undefined)
    expect(os.registered.size).toBe(0)
    expect(shortcut.state()).toBe('none')
  })

  it('AC7: reports failed when the OS refuses, and tries again only when it changes', () => {
    const os = fakeOs(['Control+Alt+Shift+D', 'Control+Alt+K'])
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    expect(shortcut.state()).toBe('failed')
    // A save that keeps it asks nothing more.
    shortcut.set('Ctrl+Alt+Shift+D')
    expect(os.asked).toEqual(['Control+Alt+Shift+D'])
    shortcut.set('Ctrl+Alt+K')
    expect(os.asked).toEqual(['Control+Alt+Shift+D', 'Control+Alt+K'])
    expect(shortcut.state()).toBe('failed')
    os.refuse.length = 0
    shortcut.set('Ctrl+Alt+Shift+D')
    expect(shortcut.state()).toBe('registered')
    expect([...os.registered.keys()]).toEqual(['Control+Alt+Shift+D'])
  })

  it("reports failed when the OS throws on an accelerator it can't parse (D8)", () => {
    const os = fakeOs()
    os.register = () => {
      throw new TypeError('Error processing argument at index 0')
    }
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    expect(() => shortcut.set('Ctrl+Alt+Shift+D')).not.toThrow()
    expect(shortcut.state()).toBe('failed')
  })

  it('unregisters while suspended and registers again on resume (D6)', () => {
    const os = fakeOs()
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    shortcut.suspend()
    shortcut.suspend()
    expect(os.registered.size).toBe(0)
    expect(shortcut.state()).toBe('registered')
    shortcut.resume()
    shortcut.resume()
    expect([...os.registered.keys()]).toEqual(['Control+Alt+Shift+D'])
    expect(os.asked).toEqual(['Control+Alt+Shift+D', 'Control+Alt+Shift+D'])
  })

  it('keeps a shortcut set while suspended until resume, which tries it (D6, D8)', () => {
    const os = fakeOs()
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    shortcut.suspend()
    shortcut.set('Ctrl+Alt+K')
    expect(os.registered.size).toBe(0)
    expect(shortcut.state()).toBe('none')
    shortcut.resume()
    expect([...os.registered.keys()]).toEqual(['Control+Alt+K'])
    expect(shortcut.state()).toBe('registered')
  })

  it('a failed one is tried again on resume', () => {
    const os = fakeOs(['Control+Alt+Shift+D'])
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    shortcut.suspend()
    expect(shortcut.state()).toBe('failed')
    os.refuse.length = 0
    shortcut.resume()
    expect(shortcut.state()).toBe('registered')
  })

  it('dispose unregisters it and registers nothing after (D10)', () => {
    const os = fakeOs()
    const shortcut = new GlobalShortcut(os, 'linux', () => {})
    shortcut.set('Ctrl+Alt+Shift+D')
    shortcut.dispose()
    expect(os.registered.size).toBe(0)
    shortcut.set('Ctrl+Alt+K')
    shortcut.resume()
    expect(os.registered.size).toBe(0)
  })

  it('uses Super for Cmd off macOS and Command on it (D7)', () => {
    const linux = fakeOs()
    new GlobalShortcut(linux, 'linux', () => {}).set('Cmd+Shift+Space')
    expect([...linux.registered.keys()]).toEqual(['Super+Shift+Space'])
    const darwin = fakeOs()
    new GlobalShortcut(darwin, 'darwin', () => {}).set('Cmd+Shift+Space')
    expect([...darwin.registered.keys()]).toEqual(['Command+Shift+Space'])
  })
})

describe('withFeature (#51 D8)', () => {
  it("adds the portal feature to Chromium's enable-features, keeping any already set", () => {
    expect(withFeature('', 'GlobalShortcutsPortal')).toBe('GlobalShortcutsPortal')
    expect(withFeature('Foo,Bar', 'GlobalShortcutsPortal')).toBe('Foo,Bar,GlobalShortcutsPortal')
    expect(withFeature('Foo,GlobalShortcutsPortal', 'GlobalShortcutsPortal')).toBe(
      'Foo,GlobalShortcutsPortal'
    )
  })
})
