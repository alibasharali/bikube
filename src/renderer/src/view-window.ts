import { createContext, useContext } from 'react'

/**
 * The window a view is shown in (#53 D5): the main window, or a card's own window, which the main
 * window's page draws into. Its code runs in the main page, so the globals `window` and `document`
 * are always the main window's; a view's keys, dialogs, focus and sizes go through this one.
 */
export const ViewWindowContext = createContext<Window>(window)

/** The window the calling view is shown in. */
export function useViewWindow(): Window {
  return useContext(ViewWindowContext)
}

/** Whether a dialog in `view`'s document owns its keyboard (a dialog belongs to its window, D5). */
export function dialogOpenIn(view: Window): boolean {
  return view.document.querySelector('[aria-modal="true"]') !== null
}
