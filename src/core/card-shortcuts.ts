/** Keyboard shortcuts of the full-size card view (#4 D8) and the app (#10 D5), free of DOM imports. */
import type { KeyLike } from './clipboard'

/**
 * Back to the board: Cmd+Shift+B on macOS, Ctrl+Shift+B elsewhere. Matches every event type
 * (keydown, keypress, keyup) so the terminal can swallow the whole key; act on keydown only.
 */
export function isBackShortcut(event: KeyLike, platform: string): boolean {
  if (event.altKey || !event.shiftKey || event.key.toLowerCase() !== 'b') return false
  return platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * Open Settings (#10 D5): Cmd+, on macOS, Ctrl+, elsewhere. Like `isBackShortcut`, matches every
 * event type so the terminal can swallow the whole key; act on keydown only.
 */
export function isSettingsShortcut(event: KeyLike, platform: string): boolean {
  if (event.altKey || event.shiftKey || event.key !== ',') return false
  return platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}
