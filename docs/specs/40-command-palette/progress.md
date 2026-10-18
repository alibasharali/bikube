# Progress #40 Command palette and quick card switcher

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `73a0dca..286136f` | CLEAN | `src/core/palette.ts`: `paletteItems(PaletteInput)`, `filterPalette(items, query)`, `matchScore`; `PaletteInput {state, status(cardId)->RowStatus, view: OpenView|null, theme, keymap, platform}`; `OpenView {kind, workspaceId, cardId, running, paneCount, extraPaneFocused}`; `PaletteAction` ids back/splitRight/splitDown/closePane/closeCard/togglePanel/find/moveCard{columnId}/newCard/openShell/newWorkspace/settings/theme{theme}/switchWorkspace{workspaceId}; rows TerminalRow (card/shell) and ActionRow |
| S2 | todo | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

- None yet.

## Verification

- todo
