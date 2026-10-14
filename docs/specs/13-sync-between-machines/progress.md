# Progress #13 Sync between machines

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b0fc0f3..5305eb6` | CLEAN | `core/sync-file.ts`: `portableDirectory`, `expandHome`, `toSyncBoard`, `serializeSyncFile`, `parseSyncFile(text, home)` (local cards claudeStarted false), `joinBoards`; `core/sync-folder.ts`: `SyncFolder({fs, home, now, log, onStatus})` `start`, `setFolder` (joined board or null), `noteBoard`, `flush`, `status`, keeps last board read/written; `core/sync-status.ts`: `SyncStatus` (off, synced{folder,time}, unavailable, unreadable), `syncStatusText`, `syncFolderOf`; IPC `sync:status`, `sync:statusChanged`, `sync:setFolder`, `sync:pickFolder`, `sync:board`; store `replaceBoard(workspaces)`; `MainState.load()`, `registerState(onSaved)`, `MainSettings.syncFolder()/setSyncFolder()`; e2e helpers in `e2e/sync.spec.ts`: `launch(home, dataDir?)`, `setSyncFolder`, `readSyncFile` |
| S2 | done | `898a72e..36fad8c` | fixed r1 | `core/sync-apply.ts`: `applySyncBoard(incoming, local, isRunning)` (D6/D8); `withBoard(state, workspaces)` in workspace-store; `SyncFolder.start` returns board to apply or null; `SyncFolder.read()` returns a board only when it differs from last, drops pending older write; `MainState.set(state)`; renderer `receiveSyncBoards()`, exported `disposeCard`; main reads at launch, folder watch (100 ms settle), `browser-window-focus`; a missing file on a live read gets this machine's board written (since S3); valid file after unreadable sets status synced |
| S3 | done | `28a9f1a..0db9875` | fixed r2 (ruling round 2 Q1) | `SyncFolderFs` = `StateFileFs` + `statSync`; `joinOwed` (in memory) runs D9's join on the first valid read/recovery; main polls `readNow` every 2 s only while unavailable and re-watches on recovery |

## Rulings

- 2026-10-14: Idea promoted to feature by full auto; grilling round 1 answered by full auto; spec approved by full auto (no stack change).

- 2026-10-14 S3 (full auto, round 2 Q1): sync turned on while the folder is unavailable or its file unreadable → the join is still owed and runs on the first valid read or recovery (D9 updated).
- 2026-10-14 ship review (full auto, round 3): (1) leaving unreadable recovers like unavailable; (2) re-read the file before every write; (3) turning off / switching folders writes the pending change to the old folder first (D10, D12 updated); (4) sync fs stays synchronous on main, a trade-off with a follow-up idea for async sync I/O.

## Verification

- done (ALL PASS; posted to the item)
