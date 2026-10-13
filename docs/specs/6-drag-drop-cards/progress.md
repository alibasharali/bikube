# Progress #6 Drag and drop cards

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `3e94c1e..47fac01` | fixed r1 | `WorkspaceStore.moveCard(workspaceId, cardId, toColumnId, toIndex): Result<void>`; index among target cards without the moved one, floored, <0 → top, past end/NaN → bottom; same place is a no-op (no notify). Hint `Move or delete its cards first`. |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-13: Spec approved by full auto (no stack change); grilling round 1 answered by full auto with the recommendations.

## Verification

- todo
