import { useEffect } from 'react'

/**
 * A failed trigger's output dialog asked for from outside its row (its notification's click):
 * kept until that trigger's row is shown, which opens it, since the row may mount later (another
 * workspace, the Shells tab hidden).
 */
let requested: string | null = null
const listeners = new Set<() => void>()

export function showTriggerFailure(shellId: string): void {
  requested = shellId
  for (const listener of [...listeners]) listener()
}

/** Calls `open` when the dialog of trigger `shellId` is asked for, now or later. */
export function useTriggerFailureRequest(shellId: string, open: () => void): void {
  useEffect(() => {
    const check = (): void => {
      if (requested !== shellId) return
      requested = null
      open()
    }
    check()
    listeners.add(check)
    return () => {
      listeners.delete(check)
    }
  }, [shellId, open])
}
