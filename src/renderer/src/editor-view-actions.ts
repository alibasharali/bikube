/**
 * The file editor view's Open in <editor> (#83 D9), run by its header button and by the command
 * palette's row (D15) through the same code: the tab in front registers it while it shows, so the
 * palette's row shows the same error or note line under the header.
 */
let openInEditor: (() => void) | null = null

/** Makes `run` the tab in front's Open in <editor>; returns what removes it again. */
export function registerOpenInEditor(run: () => void): () => void {
  openInEditor = run
  return () => {
    if (openInEditor === run) openInEditor = null
  }
}

/** Opens the tab in front in Settings > Editor, as its header button does; nothing without one. */
export function runOpenInEditor(): void {
  openInEditor?.()
}
