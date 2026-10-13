# Progress #8 Persistence

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `0a5e98e..a7eca5e` | CLEAN | `src/core/saved-state.ts`: `STATE_FILE_NAME`, `SAVED_STATE_VERSION`, `SavedStateResult`, `serializeSavedState(state)`, `parseSavedState(text)`, `validateWorkspaceState(value: unknown)`, `corruptFileName(now)`; `StoreOptions.initialState` |
| S2 | done | `303bf76..723824e` | ruling r2 Q1, fixed r1, CLEAN | `IPC.stateLoad`/`IPC.stateSave`; `window.drovr.state` (`StateApi { load(): Promise<WorkspaceState>; save(state): void }`); core `StateFile` (`load`, `save(value: unknown): boolean`, `flush`, `SAVE_INTERVAL_MS`); main `registerState()` → `{ flush }`; `DROVR_USER_DATA_DIR` sets `userData` |
| S3 | done | `93fb13c..65caa93` | CLEAN | `knownRunState`/`knownStatus` (card-status.ts); `createWorkspaceStore`, `loadWorkspaceStore` (renderer store.ts); `e2e/launch.ts` `launchApp`, `newDataDir` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-13 S2 (full auto, round 2 Q1): unreadable file, or a rejected file that can't be moved aside → try to move it aside like a rejected file; if that fails, start empty and save nothing for the session (logged). Spec D4 updated.

## Verification

- done (ALL PASS)
