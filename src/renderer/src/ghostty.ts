import { useSyncExternalStore } from 'react'
import type { GhosttyConfig } from '../../core/ghostty-config'
import type { GhosttyPalettes } from '../../core/terminal-appearance'
import type { Settings } from '../../core/settings'

/**
 * The user's Ghostty config, read by main while "Use Ghostty config" or "Use Ghostty shortcuts"
 * is on: at launch, when either is turned on, and on Reload. Null until the first read.
 */
let current: GhosttyConfig | null = null
const listeners = new Set<() => void>()
let reading: Promise<void> | null = null

export const ghosttyStore = {
  get: (): GhosttyConfig | null => current,
  palettes: (): GhosttyPalettes => (current ? { dark: current.dark, light: current.light } : null),
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Reads the Ghostty config again; a read already running is reused. */
  reload(): Promise<void> {
    reading ??= window.bikube.settings
      .ghosttyConfig()
      .then((theme) => {
        current = theme
        for (const listener of [...listeners]) listener()
      })
      .finally(() => {
        reading = null
      })
    return reading
  }
}

/** Reads the Ghostty config before the first render when either setting is on. */
export async function loadGhosttyConfig(settings: Settings): Promise<void> {
  if (settings.useGhosttyConfig || settings.useGhosttyShortcuts) {
    await ghosttyStore.reload().catch(() => undefined)
  }
}

export function useGhosttyRead(): GhosttyConfig | null {
  return useSyncExternalStore(ghosttyStore.subscribe, ghosttyStore.get)
}
