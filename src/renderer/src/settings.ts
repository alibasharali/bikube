import { useSyncExternalStore } from 'react'
import { resolveKeymap, type Keymap } from '../../core/keymap'
import { validateSettings, type Settings } from '../../core/settings'

/** The app-wide settings in the renderer (#10 D1, D6): read them, and change them in place. */
export interface SettingsStore {
  /** The current settings; a new object after each change, so it can feed React. */
  get(): Settings
  /**
   * Applies `change` when the result is valid (D1; the family is trimmed, empty means default),
   * tells subscribers and sends the whole settings to `save`. Returns false, changing nothing,
   * when it isn't valid; a valid change that leaves the settings as they are returns true without
   * telling or saving (D7: nothing is written until a setting changes).
   */
  update(change: Partial<Settings>): boolean
  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/** Whether two sets of shortcut overrides hold the same entries (both in action order). */
const sameShortcuts = (a: Settings['shortcuts'], b: Settings['shortcuts']): boolean =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/** `platform` is the OS the app runs on, whose default shortcuts apply (#31 D6, D9). */
export function createSettingsStore(
  initial: Settings,
  save: (settings: Settings) => void,
  platform: string
): SettingsStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    update(change) {
      const next = validateSettings({ ...current, ...change }, platform)
      if (next === null) return false
      if (
        next.theme === current.theme &&
        next.fontSize === current.fontSize &&
        next.fontFamily === current.fontFamily &&
        sameShortcuts(next.shortcuts, current.shortcuts)
      ) {
        return true
      }
      current = next
      for (const listener of [...listeners]) listener()
      save(next)
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/**
 * The app-wide settings store, seeded by `loadSettingsStore` before the first render. Importers
 * read this live binding at call time, never at module load.
 */
export let settingsStore: SettingsStore

/** Loads the settings from main once and creates the app-wide store from them (#10 D6). */
export async function loadSettingsStore(): Promise<void> {
  const loaded = await window.drovr.settings.load()
  settingsStore = createSettingsStore(
    loaded,
    (next) => window.drovr.settings.save(next),
    window.drovr.platform
  )
}

/** Every configurable shortcut in effect now (#31 D5, D9); read at the time of each key press. */
export function currentKeymap(): Keymap {
  return resolveKeymap(settingsStore.get().shortcuts, window.drovr.platform)
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => settingsStore.subscribe(listener),
    () => settingsStore.get()
  )
}
