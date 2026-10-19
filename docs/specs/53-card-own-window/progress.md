# Progress #53 Open a card in its own window

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `269c4a2..f9ef4d6` | fixed r1 | renderer `card-windows.ts`: `openCardWindow(workspaceId, cardId)` (shell ids too), `focusCardWindow(cardId): boolean`, `closeCardWindow`, `isInWindow`, `useInWindow`, `subscribeCardWindows`; `view-window.ts`: `ViewWindowContext`, `useViewWindow()`, `dialogOpenIn(view)`; IPC `cardWindow:focus` (`window.drovr.cardWindow.focus`); main `appWindow()` in src/main/card-windows.ts; `CardLines` prop `inWindow`, chip testid `card-in-window`, menu testid `card-menu-open-window`; `cardWindowTitle` in window-title.ts. Left: view memory still holds a popped-out open card (S2); Files tab focus refresh main-only (S3). |
| S2 | todo | | | |
| S3 | todo | | | |

## Rulings

- 2026-10-19: grilling round 1 answered by full auto with the recommendations (see the spec's D1–D10).

## Verification

- todo
