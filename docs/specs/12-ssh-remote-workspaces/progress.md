# Progress #12 SSH and remote workspaces

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `04a2a80..3d7b937` | CLEAN | `src/core/ssh-location.ts`: `checkHost(raw)`, `checkRemoteDirectory(raw)` → `{ok,value}|{ok:false,message}`, `HOST_REQUIRED`, `HOST_INVALID`, `REMOTE_DIRECTORY_REQUIRED`, `REMOTE_DIRECTORY_INVALID`; `Workspace.host?`, `Card.host?` (absent when local; createCard copies it); `WorkspaceInput/Patch.host?: string | null`; `defaultWorkspaceName(directory, host?)`; form drafts `location`, `host`, `applyHost`, `applyLocation`; e2e `e2e/ssh.spec.ts` creates `/tmp/drovr-remote` (S2 must add fake ssh to its env) |
| S2 | todo | | | |
| S3 | todo | | | |

## Rulings

- 2026-10-14: Idea promoted to feature by full auto; grilling round 1 answered by full auto; spec approved by full auto (no stack change).

## Verification

- todo
