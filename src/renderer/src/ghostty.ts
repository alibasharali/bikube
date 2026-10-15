import { useSyncExternalStore } from 'react'
import type { GhosttyTheme } from '../../core/ghostty-config'
import type { GhosttyPalettes } from '../../core/terminal-appearance'
import { settingsStore } from './settings'

/**
 * The user's Ghostty colours, read by main when "Use Ghostty theme" is on: at launch, when the
 * setting is turned on, and on Reload. Null until the first read.
 */
let current: GhosttyTheme | null = null
const listeners = new Set<() => void>()
let reading: Promise<void> | null = null

export const ghosttyStore = {
  get: (): GhosttyTheme | null => current,
  palettes: (): GhosttyPalettes => (current ? { dark: current.dark, light: current.light } : null),
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Reads the Ghostty config again; a read already running is reused. */
  reload(): Promise<void> {
    reading ??= window.drovr.settings
      .ghosttyTheme()
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

/** Reads the Ghostty colours before the first render when the setting is on. */
export async function loadGhosttyTheme(): Promise<void> {
  if (settingsStore.get().useGhosttyTheme) await ghosttyStore.reload().catch(() => undefined)
}

export function useGhosttyTheme(): GhosttyTheme | null {
  return useSyncExternalStore(ghosttyStore.subscribe, ghosttyStore.get)
}
