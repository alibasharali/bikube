import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings, PREFERENCE_DEFAULTS } from '../../core/settings'
import { createSettingsStore } from './settings'

/** The settings after #10's three, at their defaults. */
const NEW_FIELDS = {
  shell: '',
  terminalThemeDark: 'Bikube Dark',
  terminalThemeLight: 'Bikube Light',
  useGhosttyTheme: false,
  ...PREFERENCE_DEFAULTS
}

describe('createSettingsStore (#10 D6)', () => {
  it('starts from the loaded settings', () => {
    const loaded: Settings = {
      theme: 'light',
      fontSize: 16,
      fontFamily: 'Courier New',
      ...NEW_FIELDS
    }
    expect(createSettingsStore(loaded, vi.fn(), 'linux').get()).toEqual(loaded)
  })

  it('applies a valid change, tells subscribers and sends the whole settings to save', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save, 'linux')
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.update({ theme: 'dark', fontFamily: '  Courier New  ' })).toBe(true)
    const next = { theme: 'dark', fontSize: 13, fontFamily: 'Courier New', ...NEW_FIELDS }
    expect(store.get()).toEqual(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(next)
  })

  it('ignores an invalid change: nothing applied, told or saved', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save, 'linux')
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()
    expect(store.update({ fontSize: 40 })).toBe(false)
    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('changes nothing for an update that leaves the settings as they are: not told, not saved', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save, 'linux')
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()
    expect(store.update({ theme: 'system', fontFamily: `  ${DEFAULT_SETTINGS.fontFamily} ` })).toBe(
      true
    )
    expect(store.update({ fontFamily: '' })).toBe(true)
    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('stops telling a listener once it unsubscribes', () => {
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, vi.fn(), 'linux')
    const listener = vi.fn()
    store.subscribe(listener)()
    store.update({ theme: 'light' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('changes a shortcut, keeps only those that differ from the default and saves them (#31 D9)', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save, 'linux')
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.update({ shortcuts: { splitRight: 'Ctrl+Alt+R', back: 'Ctrl+Shift+B' } })).toBe(
      true
    )
    expect(store.get().shortcuts).toEqual({ splitRight: 'Ctrl+Alt+R' })
    expect(save).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      shortcuts: { splitRight: 'Ctrl+Alt+R' }
    })
    expect(store.update({ shortcuts: { splitRight: 'Ctrl+Alt+R' } })).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.update({ shortcuts: {} })).toBe(true)
    expect(store.get().shortcuts).toBeUndefined()
    expect(save).toHaveBeenLastCalledWith(DEFAULT_SETTINGS)
    expect(store.update({ shortcuts: { splitRight: 'Ctrl+Shift+B' } })).toBe(false)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('sets and clears the global shortcut, saving each, and refuses an in-app one (#51 D5, D9)', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save, 'linux')
    expect(store.update({ globalShortcut: 'Ctrl+Alt+Shift+D' })).toBe(true)
    expect(save).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      globalShortcut: 'Ctrl+Alt+Shift+D'
    })
    expect(store.update({ globalShortcut: undefined })).toBe(true)
    expect(store.get().globalShortcut).toBeUndefined()
    expect(save).toHaveBeenLastCalledWith(DEFAULT_SETTINGS)
    expect(store.update({ globalShortcut: 'Ctrl+Shift+P' })).toBe(false)
    expect(save).toHaveBeenCalledTimes(2)
  })
})
