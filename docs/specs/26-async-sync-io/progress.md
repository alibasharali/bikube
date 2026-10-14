# Progress #26 Async I/O for the sync folder

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f505534..bdb4854` | fixed r2 | `SyncFolder`: `start/read/setFolder(): Promise<Workspace[] \| null>` (never reject; `start` sets the folder at once), `flush(): Promise<void>` (resolves once the queue is empty), `busy(): boolean`, `noteBoard` sync. `MainSync.flush(): Promise<void>` (stops watch and retry at once). index.ts quit does `void sync.flush()` until S2. Note for S2: a `state:save` in flight when a valid launch read finishes is written once over the file, then corrected when the window applies it; the launch gate narrows this. |
| S2 | running | | | |

## Rulings

- 2026-10-14 S1 (full auto, reviewer HUMAN finding): a board change saved while the launch read is still running was dropped (folder set only inside the queued start). → `start` sets the folder at once and the launch op uses the latest noted local board; a valid file still wins at launch (#13 D11). Fixed in S1's review round.
- 2026-10-14 S2 (full auto, implementer finding): a libuv worker blocked on a stalled fs call keeps the process alive forever after quit (and the single-instance lock with it). → option (a): at Electron's `quit` with sync still busy, main SIGKILLs itself (spec D5/AC6 updated in its own commit).

## Verification

- todo
