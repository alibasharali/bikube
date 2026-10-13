/** Keyboard shortcuts of the full-size card view (#4 D8), free of DOM imports. */
import type { KeyLike } from './clipboard'

/**
 * Back to the board: Cmd+Shift+B on macOS, Ctrl+Shift+B elsewhere. Matches every event type
 * (keydown, keypress, keyup) so the terminal can swallow the whole key; act on keydown only.
 */
export function isBackShortcut(event: KeyLike, platform: string): boolean {
  if (event.altKey || !event.shiftKey || event.key.toLowerCase() !== 'b') return false
  return platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}
