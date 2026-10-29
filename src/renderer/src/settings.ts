import { useSyncExternalStore } from 'react'
import { withGhosttyConfig } from '../../core/ghostty-config'
import { ghosttyBinds, withGhosttyShortcuts, type GhosttyKeymap } from '../../core/ghostty-keybinds'
import { resolveKeymap, type Keymap } from '../../core/keymap'
import { validateSettings, type Settings } from '../../core/settings'
import { ghosttyStore } from './ghostty'

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
      const keys = (Object.keys(next) as (keyof Settings)[]).filter((key) => key !== 'shortcuts')
      if (
        keys.every((key) => next[key] === current[key]) &&
        // Absent when cleared, so not among `next`'s keys (#51 D5).
        next.globalShortcut === current.globalShortcut &&
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
  const loaded = await window.bikube.settings.load()
  settingsStore = createSettingsStore(
    loaded,
    (next) => window.bikube.settings.save(next),
    window.bikube.platform
  )
}

let ownKeymapFor: { settings: Settings; keymap: Keymap } | undefined

/**
 * Every configurable shortcut in effect now (#31 D5, D9), Ghostty's included while "Use Ghostty
 * shortcuts" is on; read at the time of each key press. The same object until the settings or
 * the Ghostty config change, so it can feed React.
 */
export function currentKeymap(): Keymap {
  const ghostty = ghosttyKeymap()
  if (ghostty) return ghostty.keymap
  const settings = settingsStore.get()
  if (ownKeymapFor?.settings !== settings) {
    ownKeymapFor = { settings, keymap: resolveKeymap(settings.shortcuts, window.bikube.platform) }
  }
  return ownKeymapFor.keymap
}

let keymapFor: { settings: Settings; ghostty: unknown; result: GhosttyKeymap } | undefined

/**
 * The shortcuts with Ghostty's laid over them while "Use Ghostty shortcuts" is on and its config is
 * read, with which actions they set and what was skipped; null otherwise. Kept until either changes.
 */
export function ghosttyKeymap(): GhosttyKeymap | null {
  const settings = settingsStore.get()
  const ghostty = ghosttyStore.get()
  if (!settings.useGhosttyShortcuts || ghostty === null) return null
  if (keymapFor?.settings !== settings || keymapFor.ghostty !== ghostty) {
    const { platform } = window.bikube
    const result = withGhosttyShortcuts(
      resolveKeymap(settings.shortcuts, platform),
      ghosttyBinds(ghostty.keybinds, platform),
      platform
    )
    keymapFor = { settings, ghostty, result }
  }
  return keymapFor.result
}

let effectiveFor: { settings: Settings; ghostty: unknown; result: Settings } | undefined

/**
 * The settings in effect: Bikube's, with what the Ghostty config sets while "Use Ghostty config"
 * is on. The same object until either changes, so it can feed React.
 */
export function effectiveSettings(): Settings {
  const settings = settingsStore.get()
  const ghostty = ghosttyStore.get()
  if (effectiveFor?.settings !== settings || effectiveFor.ghostty !== ghostty) {
    effectiveFor = { settings, ghostty, result: withGhosttyConfig(settings, ghostty) }
  }
  return effectiveFor.result
}

const subscribeBoth = (listener: () => void): (() => void) => {
  const offSettings = settingsStore.subscribe(listener)
  const offGhostty = ghosttyStore.subscribe(listener)
  return () => {
    offSettings()
    offGhostty()
  }
}

/** `effectiveSettings()`, re-rendering when the settings or the Ghostty config change. */
export function useEffectiveSettings(): Settings {
  return useSyncExternalStore(subscribeBoth, effectiveSettings)
}

/** `currentKeymap()`, re-rendering when the settings or the Ghostty config change. */
export function useKeymap(): Keymap {
  return useSyncExternalStore(subscribeBoth, currentKeymap)
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => settingsStore.subscribe(listener),
    () => settingsStore.get()
  )
}
