import { onQuitSave } from './card-terminals'
import { editorFiles } from './editor-files'
import { workspaceStore } from './store'

/**
 * Dirty editor tabs' drafts (#83 D11): every pending draft is sent as the app starts quitting,
 * before main is told the quit saves were sent; at launch each kept draft of a workspace that
 * still exists reopens its tab dirty (the board still in front), the others' are deleted, and the
 * files are checked against the drafts' bases (D13). Call once the board has loaded.
 */
export function startEditorDrafts(): void {
  onQuitSave(() => editorFiles.flushDrafts())
  void window.bikube.drafts
    .list()
    .then((drafts) =>
      editorFiles.restore(
        drafts,
        workspaceStore.getState().workspaces.map((w) => w.id)
      )
    )
    .catch((err: unknown) => console.error('drafts not restored:', err))
}
