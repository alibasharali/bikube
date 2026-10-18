# Progress #55 Right side panel for open card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `3168902..bdb61a2` | CLEAN | Prefs `sidePanelOpen`/`sidePanelWidth` (+ `MIN/MAX_SIDE_PANEL_WIDTH`) in settings.ts; keymap action `togglePanel`; `src/core/side-panel.ts` width helpers; `SidePanel({folder, ssh, onHide})` in CardView's `.card-layout`, tabs in `PANEL_TABS`; `FilesTab({folder, ssh})` in FilesTab.tsx, local body is a placeholder `data-testid="files-tab"` (S2 fills it); test ids `side-panel`, `side-panel-resize`, `side-panel-tab-files`, `side-panel-hide`, `titlebar-panel`; no preload API yet |
| S2 | done | `395a765..a75ab57` | fixed r1 | IPC `files:list` → `window.drovr.files.list(folder, path)` → `FolderListing` (`{ok:true, entries, more} \| {ok:false, reason:'outside'\|'unreadable'}`), path relative `/`-separated, `''` = root; main in `src/main/files.ts`; core `src/core/file-tree.ts`: `insideFolder(root, path)` (path guard, reuse for open), `listFolder`, `ignoredNames`, `FOLDER_CAP`; `git.ts` `readOnlyGit(runner, base)` (`--no-optional-locks`, run status through it); `src/core/tree-rows.ts` `visibleRows`, `treeKey`; renderer `src/renderer/src/file-tree.ts` `refreshTree(folder)` (serialized per folder), `toggleFolder`, `useFolderTree` (S3 adds status here); status letters go in FilesTab `Row` after `.files-name`, Changed only in `.files-header` beside Refresh (`files-refresh`); `FilesTab` `onOpenFile?(path)` no-op seam, SidePanel doesn't pass it yet; rows `files-row` with `data-path`, `data-kind`, `data-ignored`, `aria-expanded`, `aria-selected` |
| S3 | running | | | |
| S4 | todo | | | |

## Rulings

- none yet

## Verification

- todo
