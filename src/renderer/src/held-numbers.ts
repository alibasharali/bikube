import { useEffect, useState } from 'react'
import { heldNumbers } from '../../core/keymap'

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

export type HeldNumbers = 'workspace' | 'terminal' | null

/**
 * Which numbers the sidebar shows: `workspace` while Mod is held alone (Mod+1…9), `terminal`
 * while the terminal modifier is (Ctrl+1…9 on macOS, Alt+1…9 elsewhere), else null. Shown at
 * once, kept while digits are pressed with it, gone on release, any other key (a combo) or blur.
 */
export function useHeldNumbers(platform: string): HeldNumbers {
  const [shown, setShown] = useState<HeldNumbers>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const held = heldNumbers(event, platform)
      if (held === null || document.querySelector('[aria-modal="true"]')) setShown(null)
      else if (MODIFIER_KEYS.has(event.key)) {
        if (event.type === 'keydown') setShown(held)
      } else if (!/^Digit[1-9]$/.test(event.code)) setShown(null)
    }
    const clear = (): void => setShown(null)
    const types = ['keydown', 'keyup'] as const
    for (const type of types) window.addEventListener(type, onKey, true)
    window.addEventListener('blur', clear)
    return () => {
      for (const type of types) window.removeEventListener(type, onKey, true)
      window.removeEventListener('blur', clear)
    }
  }, [platform])
  return shown
}
