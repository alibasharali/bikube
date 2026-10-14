/** Keyboard shortcuts of the full-size card view (#4 D8) and the app (#10 D5), free of DOM imports. */
import type { KeyLike } from './clipboard'
import type { SplitDirection } from './split-tree'

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

/**
 * Splitting the focused pane (#11 D4): Cmd+D right and Cmd+Shift+D down on macOS; Ctrl+Shift+D
 * right and Ctrl+Shift+E down elsewhere (plain Ctrl+D is end of input). Like `isBackShortcut`,
 * matches every event type so the terminal can swallow the whole key; act on keydown only.
 */
export function splitShortcut(event: KeyLike, platform: string): SplitDirection | null {
  if (event.altKey) return null
  const key = event.key.toLowerCase()
  if (platform === 'darwin') {
    if (!event.metaKey || event.ctrlKey || key !== 'd') return null
    return event.shiftKey ? 'down' : 'right'
  }
  if (!event.ctrlKey || event.metaKey || !event.shiftKey) return null
  return key === 'd' ? 'right' : key === 'e' ? 'down' : null
}
