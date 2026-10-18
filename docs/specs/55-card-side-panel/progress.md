# Progress #55 Right side panel for open card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `3168902..bdb61a2` | CLEAN | Prefs `sidePanelOpen`/`sidePanelWidth` (+ `MIN/MAX_SIDE_PANEL_WIDTH`) in settings.ts; keymap action `togglePanel`; `src/core/side-panel.ts` width helpers; `SidePanel({folder, ssh, onHide})` in CardView's `.card-layout`, tabs in `PANEL_TABS`; `FilesTab({folder, ssh})` in FilesTab.tsx, local body is a placeholder `data-testid="files-tab"` (S2 fills it); test ids `side-panel`, `side-panel-resize`, `side-panel-tab-files`, `side-panel-hide`, `titlebar-panel`; no preload API yet |
| S2 | running | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

- none yet

## Verification

- todo
