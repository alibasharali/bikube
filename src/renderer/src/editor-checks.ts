import { editorFiles } from './editor-files'
import { anyWindowFocused, onAnyWindowFocus } from './window-focus'

/** How often open files are checked while a Bikube window is focused (#83 D13). */
export const EDITOR_CHECK_MS = 3000

/**
 * Checks every open text tab's file on disk (#83 D13): every 3 s while any Bikube window is
 * focused, and on focus. Returns what stops it.
 */
export function startEditorChecks(): () => void {
  const timer = setInterval(() => {
    if (anyWindowFocused()) void editorFiles.check()
  }, EDITOR_CHECK_MS)
  const offFocus = onAnyWindowFocus(() => void editorFiles.check())
  return () => {
    clearInterval(timer)
    offFocus()
  }
}
