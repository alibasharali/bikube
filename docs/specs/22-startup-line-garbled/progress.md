# Progress #22 Startup line can show garbled when a card opens at full size

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f5280c3..HEAD` | fixed r1 (e2e width precondition) | `CardSessions` 4th param `defer`; app passes `setTimeout(spawn, 0)` |

## Rulings

None.

## Verification

- todo
