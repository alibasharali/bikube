# Progress #2 The Board and Workspaces

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `e27836e..f19fdb3` | CLEAN | `src/core/workspace-store.ts`: `InMemoryWorkspaceStore(options?: {validateDirectory?: (dir)=>string\|null; generateId?})` implements `WorkspaceStore` (getState, subscribe, createWorkspace, updateWorkspace, deleteWorkspace, selectWorkspace, addColumn, renameColumn, moveColumn, deleteColumn; all return `Result<T>` with `{field,message}` errors); types Workspace, Column, WorkspaceState, WorkspaceInput, WorkspacePatch; `basename(path)`; `DEFAULT_COLUMN_NAMES`. Validator is synchronous: UI must pre-check directory asynchronously via fs.isDirectory and pass result in. |
| S2 | todo | | | |
| S3 | todo | | | |
| S4 | todo | | | |
| S5 | todo | | | |
| S6 | todo | | | |

## Rulings

None yet.

## Verification

- todo
