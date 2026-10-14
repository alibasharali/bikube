import { useSyncExternalStore } from 'react'
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

export function createSettingsStore(
  initial: Settings,
  save: (settings: Settings) => void
): SettingsStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    update(change) {
      const next = validateSettings({ ...current, ...change })
      if (next === null) return false
      if ((Object.keys(next) as (keyof Settings)[]).every((key) => next[key] === current[key])) {
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
  settingsStore = createSettingsStore(loaded, (next) => window.drovr.settings.save(next))
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => settingsStore.subscribe(listener),
    () => settingsStore.get()
  )
}
