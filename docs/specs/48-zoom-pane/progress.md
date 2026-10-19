# Progress #48 Zoom a pane

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `ff29f46..f03e031` | CLEAN | `PaneLayout.zoomed?: true`, `toggleZoom(layout)`, `CardPanes.toggleZoom(cardId)`, `zoomPane` shortcut/card view/palette action, chip `data-testid="pane-zoom"`, `zoomPane(page)` in e2e/card-view.ts |
| S2 | done | docs only | — | — |

## Rulings

- 2026-10-19: grilling round 1 answered by full auto with the recommendations (zoom only, broadcast dropped; Shift+Cmd+Enter / Ctrl+Shift+Enter; split, closing the zoomed pane and the main shell stopping end it; `Zoomed · N panes` chip; remembered with the view).

## Verification

- todo
