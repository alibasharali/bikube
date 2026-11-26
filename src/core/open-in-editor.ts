/**
 * What Open in <editor> reads (#83 D5, D9): the Settings > Editor choice it runs. Node-free: the
 * editor view's header and the Files tab's row menu show it.
 */
import type { Editor } from './settings'

const LABELS: Record<Editor, string> = {
  vscode: 'Open in VS Code',
  cursor: 'Open in Cursor',
  zed: 'Open in Zed',
  system: 'Open with default app',
  custom: 'Open with custom command'
}

export function openInEditorLabel(editor: Editor): string {
  return LABELS[editor]
}
