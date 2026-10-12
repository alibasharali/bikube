# Progress #2 The Board and Workspaces

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `e27836e..f19fdb3` | CLEAN | `src/core/workspace-store.ts`: `InMemoryWorkspaceStore(options?: {validateDirectory?: (dir)=>string\|null; generateId?})` implements `WorkspaceStore` (getState, subscribe, createWorkspace, updateWorkspace, deleteWorkspace, selectWorkspace, addColumn, renameColumn, moveColumn, deleteColumn; all return `Result<T>` with `{field,message}` errors); types Workspace, Column, WorkspaceState, WorkspaceInput, WorkspacePatch; `basename(path)`; `DEFAULT_COLUMN_NAMES`. Validator is synchronous: UI must pre-check directory asynchronously via fs.isDirectory and pass result in. |
| S2 | done | `59c494d..ceac450` | CLEAN | `window.drovr.fs.isDirectory(path: string): Promise<boolean>` (absolute paths only, no trimming/~ expansion; false on invalid); `window.drovr.dialog.pickDirectory(): Promise<string \| null>`; core `isDirectory`, `isPathArg` in `src/core/directories.ts`; `registerDirectories()` in `src/main/directories.ts`. |
| S3 | done | `4d2775d..636a999` | CLEAN | `store.ts`: `workspaceStore` singleton + `useWorkspaceState()`; `App.tsx` stub `onCreateWorkspace` (replace in S4; passed to Sidebar `onAdd` and EmptyState); `Sidebar`, `EmptyState`, `BoardPlaceholder({workspace})` (S5 replaces); testids app, sidebar, sidebar-toggle, workspace-add, workspace-item, empty-state, create-workspace, board, board-title, column, column-name. Store validateDirectory is sync/default: S4 pre-checks via fs.isDirectory and passes the result in. |
| S4 | done | `c28ff97..8bc8656` | fixed r1 (keyboard-reachable actions), then CLEAN | `src/core/workspace-form.ts` (emptyDraft, applyName, applyDirectory, validateDraft); `Modal` (role=dialog, Esc, focus trap, focus restore), `ConfirmDialog`, `WorkspaceDialog` (create/edit); Sidebar takes onEdit/onDelete; testids workspace-dialog, workspace-name, workspace-directory, workspace-browse, workspace-error-name, workspace-error-directory, workspace-submit, workspace-cancel, workspace-edit, workspace-delete, confirm-dialog, confirm-cancel, confirm-delete. Edit/delete hidden on collapsed rail. |
| S5 | done | `d00e9d1..600812b` | CLEAN | `Board.tsx` (replaces BoardPlaceholder), `BoardColumn`, `ColumnMenu`, `InlineInput`, `AddColumn`; core `inline-edit.ts`; testids board, board-title, column, column-name (h2), column-count, column-menu, menu-rename, menu-move-left, menu-move-right, menu-delete, column-rename-input, column-error, add-column, add-column-input, add-column-submit. Empty-lane text 'No cards yet'. |
| S6 | todo | | | |

## Rulings

None yet.

## Verification

- todo
