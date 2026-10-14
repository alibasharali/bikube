# Progress #13 Sync between machines

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b0fc0f3..5305eb6` | CLEAN | `core/sync-file.ts`: `portableDirectory`, `expandHome`, `toSyncBoard`, `serializeSyncFile`, `parseSyncFile(text, home)` (local cards claudeStarted false), `joinBoards`; `core/sync-folder.ts`: `SyncFolder({fs, home, now, log, onStatus})` `start`, `setFolder` (joined board or null), `noteBoard`, `flush`, `status`, keeps last board read/written; `core/sync-status.ts`: `SyncStatus` (off, synced{folder,time}, unavailable, unreadable), `syncStatusText`, `syncFolderOf`; IPC `sync:status`, `sync:statusChanged`, `sync:setFolder`, `sync:pickFolder`, `sync:board`; store `replaceBoard(workspaces)`; `MainState.load()`, `registerState(onSaved)`, `MainSettings.syncFolder()/setSyncFolder()`; e2e helpers in `e2e/sync.spec.ts`: `launch(home, dataDir?)`, `setSyncFolder`, `readSyncFile` |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

- 2026-10-14: Idea promoted to feature by full auto; grilling round 1 answered by full auto; spec approved by full auto (no stack change).

## Verification

- todo
