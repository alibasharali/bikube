# Progress #40 Command palette and quick card switcher

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `73a0dca..286136f` | CLEAN | `src/core/palette.ts`: `paletteItems(PaletteInput)`, `filterPalette(items, query)`, `matchScore`; `PaletteInput {state, status(cardId)->RowStatus, view: OpenView|null, theme, keymap, platform}`; `OpenView {kind, workspaceId, cardId, running, paneCount, extraPaneFocused}`; `PaletteAction` ids back/splitRight/splitDown/closePane/closeCard/togglePanel/find/moveCard{columnId}/newCard/openShell/newWorkspace/settings/theme{theme}/switchWorkspace{workspaceId}; rows TerminalRow (card/shell) and ActionRow |
| S2 | done | `cdda3f2..fe33bdd` | CLEAN | `palette` ShortcutAction (Cmd+K / Ctrl+Shift+P, `Command palette`); App `paletteOpen` + `onPaletteOpen(workspaceId, cardId)`; `CommandPalette {open, onClose, onOpenTerminal(row)}` with `SECTIONS` (add actions + `onRunAction(PaletteAction)`; `run()` closes first); Modal `hideTitle`, `backdropClassName`; testids palette-row/-row-title/-row-meta/-section[data-section]/-input/-empty |
| S3 | done | `285c3b7..cdfe160` | ruling (spec wording) | `card-view-actions.ts` (`registerCardViewActions`, `runCardViewAction`), `new-card-request.ts` (`requestNewCard`), `ShortcutKeys.tsx`, `CommandPalette.onRunAction` |
| S4 | done | `f26d5c9..47d7cf0` | CLEAN (docs, orchestrator read) | |

## Rulings

- 2026-10-18 S3: macOS shortcut display (D6/AC9 text vs AC7 match Settings) → shown as Settings shows them (`⌘2`); D6/AC9 wording fixed (full auto, round 2).

## Verification

- done: ALL PASS (12/12 palette e2e, 114/114 regression)
