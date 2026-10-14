import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings'
import { createSettingsStore } from './settings'

describe('createSettingsStore (#10 D6)', () => {
  it('starts from the loaded settings', () => {
    const loaded: Settings = { theme: 'light', fontSize: 16, fontFamily: 'Courier New' }
    expect(createSettingsStore(loaded, vi.fn()).get()).toEqual(loaded)
  })

  it('applies a valid change, tells subscribers and sends the whole settings to save', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.update({ theme: 'dark', fontFamily: '  Courier New  ' })).toBe(true)
    const next = { theme: 'dark', fontSize: 13, fontFamily: 'Courier New' }
    expect(store.get()).toEqual(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(next)
  })

  it('ignores an invalid change: nothing applied, told or saved', () => {
    const save = vi.fn()
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, save)
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()
    expect(store.update({ fontSize: 40 })).toBe(false)
    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('stops telling a listener once it unsubscribes', () => {
    const store = createSettingsStore({ ...DEFAULT_SETTINGS }, vi.fn())
    const listener = vi.fn()
    store.subscribe(listener)()
    store.update({ theme: 'light' })
    expect(listener).not.toHaveBeenCalled()
  })
})
