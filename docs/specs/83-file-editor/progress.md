# Progress #83 File editor

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Stack and file access | done | `a4edfbe..122b707` | fixed r1 (read-only files) | `src/core/editor-files-types.ts`: `EditorFileRef {kind:'folder'\|'listed', folder, path}`, `EditorFileBase {size,mtimeMs,sha256}`, `EditorReadResult` (text{text LF,eol,bom,base,realPath} / image{dataUrl,base,realPath} / binary / too-large{size} / missing / refused), `EditorStatResult`, `EditorWrite {text,eol,bom,base}`, `EditorWriteResult` (ok{base} / conflict / missing / refused / failed{message}), `formatSize`, `imageMimeType`, limits; core `src/core/editor-files.ts`; main `src/main/editor-files.ts` (main window main frame only, `listed` from agent-setup.ts); `window.bikube.editor.read/stat/write` |
| S2 Editor view, tabs and sidebar rows | todo | | | |
| S3 Files tab row menu | todo | | | |
| S4 Save, close and changed on disk | todo | | | |
| S5 Markdown preview | todo | | | |
| S6 Drafts | todo | | | |
| S7 Agent tab and Agent setup | todo | | | |
| S8 Shortcuts, palette, wrap | todo | | | |

## Rulings

- 2026-11-26 S1 (orchestrator, reading D12's failed write): saving a file the user can't write (e.g. 0444) fails with `permission denied` instead of being replaced through tmp+rename.
- 2026-11-26 S1: AC13's e2e (editor IPC refused from a card window) is owned by S3, which handles card windows.

## Verification

- todo
- UX review: todo
