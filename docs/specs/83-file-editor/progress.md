# Progress #83 File editor

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Stack and file access | done | `a4edfbe..122b707` | fixed r1 (read-only files) | `src/core/editor-files-types.ts`: `EditorFileRef {kind:'folder'\|'listed', folder, path}`, `EditorFileBase {size,mtimeMs,sha256}`, `EditorReadResult` (text{text LF,eol,bom,base,realPath} / image{dataUrl,base,realPath} / binary / too-large{size} / missing / refused), `EditorStatResult`, `EditorWrite {text,eol,bom,base}`, `EditorWriteResult` (ok{base} / conflict / missing / refused / failed{message}), `formatSize`, `imageMimeType`, limits; core `src/core/editor-files.ts`; main `src/main/editor-files.ts` (main window main frame only, `listed` from agent-setup.ts); `window.bikube.editor.read/stat/write` |
| S2 Editor view, tabs and sidebar rows | done | `6bce713..ece3ff3` | fixed r1 | view memory `{kind:'files'}` (`rememberFiles`, `showsFiles`); `src/core/editor-tabs.ts` (`EditorTab {id: realPath, ref}`, `WorkspaceTabs`, `openTab/selectTab/closeTab/closeWorkspaceTabs/keepWorkspaces/activeTab/tabLabels/tabPath`); renderer store `src/renderer/src/editor-files.ts` (`editorFiles`, `useEditorTabs`, `open/doc/keepState/select/close/closeAll/keep/onShow`; `EditorDoc {read, state}`); `FileEditorView.tsx` (Back via `registerCardViewActions`; Close pane not wired); `editor-look.ts` (`--editor-*`); `src/core/open-in-editor.ts` `openInEditorLabel`; test ids `file-editor`, `file-editor-tab`, `file-editor-tab-close`, `file-editor-close`, `file-editor-path`, `file-editor-open-external`, `file-editor-image`, `file-editor-message`, `workspace-file`; e2e `e2e/file-editor.spec.ts` |
| S3 Files tab row menu | done | `9ae5979..fffc627` | CLEAN | `FilesTab` prop `onOpenExternal(path)`; `MenuButton` `tabIndex`; test ids `files-row-menu`, `files-row-open-external`; AC13 e2e via `ipcMain._invokeHandlers` in `e2e/file-editor.spec.ts` |
| S4 Save, close and changed on disk | todo | | | |
| S5 Markdown preview | todo | | | |
| S6 Drafts | todo | | | |
| S7 Agent tab and Agent setup | todo | | | |
| S8 Shortcuts, palette, wrap | todo | | | |

## Rulings

- 2026-11-26 S1 (orchestrator, reading D12's failed write): saving a file the user can't write (e.g. 0444) fails with `permission denied` instead of being replaced through tmp+rename.
- 2026-11-26 S2 (orchestrator): tab lists live in the renderer store `editor-files.ts` rather than App state (D3's behaviour unchanged), since the Files tab inside a card view opens files and CodeMirror state must outlive the view.
- 2026-11-26 S1: AC13's e2e (editor IPC refused from a card window) is owned by S3, which handles card windows.

## Verification

- todo
- UX review: todo
