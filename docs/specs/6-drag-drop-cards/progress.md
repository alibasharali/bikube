# Progress #6 Drag and drop cards

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `3e94c1e..47fac01` | fixed r1 | `WorkspaceStore.moveCard(workspaceId, cardId, toColumnId, toIndex): Result<void>`; index among target cards without the moved one, floored, <0 → top, past end/NaN → bottom; same place is a no-op (no notify). Hint `Move or delete its cards first`. |
| S2 | done | `9e02926..16dc44e` | CLEAN | `core/card-moves.ts`: `cardMoveKey`, `keyMoveTarget`; `card-actions.ts`: `moveCardByKey`, `takeFocusAfterMove`; `CardItem` prop `columns`; e2e helpers in `e2e/moves.spec.ts`: `titles(column)`, `focusedCard()`, `menuMove(title,to)` |
| S3 | done | `8b06c36..aa5779e` | CLEAN | `core/card-drops.ts`: `dropIndex`, `hoverHalf`; `renderer/card-drag.ts`: `CARD_DRAG_TYPE`, `startCardDrag`, `endCardDrag`, `draggedCard` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-13: Spec approved by full auto (no stack change); grilling round 1 answered by full auto with the recommendations.

## Verification

- done: ALL PASS (AC1–AC11), 2026-10-13
