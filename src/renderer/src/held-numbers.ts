import { useEffect, useState } from 'react'
import { heldNumbers } from '../../core/keymap'

/** How long a modifier is held alone before its numbers show, so a quick Cmd+C shows none. */
const SHOW_AFTER_MS = 250

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

export type HeldNumbers = 'workspace' | 'terminal' | null

/**
 * Which numbers the sidebar shows: `workspace` while Mod is held alone (Mod+1…9), `terminal`
 * while the terminal modifier is (Ctrl+1…9 on macOS, Alt+1…9 elsewhere), else null. Shown once
 * held a moment, kept while digits are pressed with it, gone on release, another key or blur.
 */
export function useHeldNumbers(platform: string): HeldNumbers {
  const [shown, setShown] = useState<HeldNumbers>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: HeldNumbers = null
    const show = (next: HeldNumbers): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      current = next
      setShown(next)
    }
    const onKey = (event: KeyboardEvent): void => {
      const held = heldNumbers(event, platform)
      if (held === null || document.querySelector('[aria-modal="true"]')) {
        show(null)
        return
      }
      if (MODIFIER_KEYS.has(event.key)) {
        if (event.type === 'keydown' && held !== current && timer === null) {
          timer = setTimeout(() => show(held), SHOW_AFTER_MS)
        }
        return
      }
      // A key with the modifier: a combo before the numbers show, a pick once they do.
      if (held !== current) show(null)
    }
    const clear = (): void => show(null)
    const types = ['keydown', 'keyup'] as const
    for (const type of types) window.addEventListener(type, onKey, true)
    window.addEventListener('blur', clear)
    return () => {
      for (const type of types) window.removeEventListener(type, onKey, true)
      window.removeEventListener('blur', clear)
      if (timer !== null) clearTimeout(timer)
    }
  }, [platform])
  return shown
}
