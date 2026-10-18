# Progress #32 Drag and drop workspaces

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `54e2b37..2cd9840` | CLEAN | `moveWorkspace(id, toIndex)`; `WORKSPACE_DRAG_TYPE`; `.workspace-row[data-workspace-id][data-drop]` |

## Rulings

None.

## Verification

- done: AC1–AC9 pass on the running app (repo e2e + unit); AC10: check.sh and smoke green except two updates tests that need a non-root user (read-only folder; sandbox runs as root)
