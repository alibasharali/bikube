# Progress #8 Persistence

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `0a5e98e..a7eca5e` | CLEAN | `src/core/saved-state.ts`: `STATE_FILE_NAME`, `SAVED_STATE_VERSION`, `SavedStateResult`, `serializeSavedState(state)`, `parseSavedState(text)`, `validateWorkspaceState(value: unknown)`, `corruptFileName(now)`; `StoreOptions.initialState` |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- None yet.

## Verification

- todo
