/**
 * Which Bikube window has the focus (#53 D10): the main window or a card's own window, which this
 * page draws into. Everything that refreshes "while the window is focused" or "on focus" counts
 * any of them, and a card is looked at while its own window is focused.
 */

/** The card windows by card (or shell) id, while open. */
const cardWindows = new Map<string, Window>()
const listeners = new Set<() => void>()

const gainedFocus = (): void => {
  for (const listener of [...listeners]) listener()
}

window.addEventListener('focus', gainedFocus)

/** Card `cardId`'s own window opened as `view`: its focus counts from now on (D10). */
export function addCardWindow(cardId: string, view: Window): void {
  cardWindows.set(cardId, view)
  view.addEventListener('focus', gainedFocus)
}

/** Card `cardId`'s own window closed. */
export function removeCardWindow(cardId: string): void {
  const view = cardWindows.get(cardId)
  if (!view) return
  cardWindows.delete(cardId)
  view.removeEventListener('focus', gainedFocus)
}

const focused = (view: Window): boolean => {
  try {
    return !view.closed && view.document.hasFocus()
  } catch {
    return false
  }
}

/** Whether any Bikube window, the main one or a card's, has the focus. */
export function anyWindowFocused(): boolean {
  return document.hasFocus() || [...cardWindows.values()].some(focused)
}

/** The card (or shell) whose own window has the focus, or null. */
export function focusedCardWindow(): string | null {
  for (const [cardId, view] of cardWindows) if (focused(view)) return cardId
  return null
}

/**
 * Calls `listener` each time a Bikube window gains the focus, card windows opened later included.
 * Returns the unsubscribe function.
 */
export function onAnyWindowFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
