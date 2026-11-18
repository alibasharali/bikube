/** Where a fixed menu goes beside its button (#82). Node-free: the renderer runs it. */

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MenuPlacement {
  top: number
  left: number
  /** Set when the menu is taller than the room on either side: it scrolls. */
  maxHeight?: number
}

/** The gap between the button and the menu, and the menu and the window's edges. */
export const MENU_GAP = 4

/**
 * Under the button when the menu fits there, else above it when it fits there, else on the
 * side with more room, capped to it. Sideways it lines up with the button's `align` edge and
 * stays inside the window.
 */
export function menuPlacement(
  button: Box,
  menu: { width: number; height: number },
  view: { width: number; height: number },
  align: 'start' | 'end'
): MenuPlacement {
  const below = view.height - button.bottom - 2 * MENU_GAP
  const above = button.top - 2 * MENU_GAP
  const wanted = align === 'start' ? button.left : button.right - menu.width
  const left = Math.max(0, Math.min(wanted, view.width - menu.width - MENU_GAP))
  if (menu.height <= below) return { top: button.bottom + MENU_GAP, left }
  if (menu.height <= above) return { top: button.top - MENU_GAP - menu.height, left }
  if (below >= above) {
    return { top: button.bottom + MENU_GAP, left, maxHeight: Math.max(0, below) }
  }
  return { top: MENU_GAP, left, maxHeight: Math.max(0, above) }
}
