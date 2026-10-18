/** Keys a terminal sends differently from xterm.js, free of Electron and DOM imports. */

import type { KeyLike } from './clipboard'

/**
 * ESC CR for Shift+Enter, as Option+Enter sends with Option as Meta: xterm.js has no kitty keyboard
 * protocol, so a plain CR would reach Claude Code as Enter. Claude Code, zsh and fish take it as a
 * new line.
 */
export const SHIFT_ENTER = '\x1b\r'

/** Whether the event is Shift+Enter with no other modifier, on any of its key events. */
export function isShiftEnter(event: KeyLike): boolean {
  return (
    event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}
