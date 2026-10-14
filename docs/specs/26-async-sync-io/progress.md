# Progress #26 Async I/O for the sync folder

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | running | | | |
| S2 | todo | | | |

## Rulings

- 2026-10-14 S1 (full auto, reviewer HUMAN finding): a board change saved while the launch read is still running was dropped (folder set only inside the queued start). → `start` sets the folder at once and the launch op uses the latest noted local board; a valid file still wins at launch (#13 D11). Fixed in S1's review round.

## Verification

- todo
