# Progress #12 SSH and remote workspaces

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `04a2a80..3d7b937` | CLEAN | `src/core/ssh-location.ts`: `checkHost(raw)`, `checkRemoteDirectory(raw)` → `{ok,value}|{ok:false,message}`, `HOST_REQUIRED`, `HOST_INVALID`, `REMOTE_DIRECTORY_REQUIRED`, `REMOTE_DIRECTORY_INVALID`; `Workspace.host?`, `Card.host?` (absent when local; createCard copies it); `WorkspaceInput/Patch.host?: string | null`; `defaultWorkspaceName(directory, host?)`; form drafts `location`, `host`, `applyHost`, `applyLocation`; e2e `e2e/ssh.spec.ts` creates `/tmp/drovr-remote` (S2 must add fake ssh to its env) |
| S2 | done | `407118e..76edad5` | fixed r1 | `src/core/ssh-command.ts`: `sshShellLine(host, dir)` → `{ok,line}|{ok:false,reason}`, `remoteCommand(dir)`, `READY_MARKER`, `SSH_REFUSAL`; `src/core/ready-marker.ts`: `readyWatcher()` → `(chunk) => boolean`; `TerminalApi.spawn(cols, rows, cwd, cardId, host?)`; `SessionRouter.spawn(..., settle, host = null)`; `SpawnOptions.command?` (`shell -l -c`); `CardRunState` stopped `{kind:"stopped"; sshFailed?}`; `CardRef.host?`; extra panes already pass the card host (255 exit removes the pane: D8 display is S3); e2e `e2e/fake-ssh.ts`: `fakeSshHome(root)` → `{home, log, sshLog, sshEnvLog, env}`, `sshLogLines`, knobs `FAKE_SSH_DELAY`, `FAKE_SSH_FAIL_AFTER` |
| S3 | done | `433c0b6..cc7e53c` | CLEAN | SSH extra pane 255 exit keeps it read-only with `SSH failed` (card-panes); CONTEXT **SSH workspace**, **SSH failed**; AGENTS names `e2e/ssh.spec.ts`, `e2e/fake-ssh.ts` |

## Rulings

- 2026-10-14: Idea promoted to feature by full auto; grilling round 1 answered by full auto; spec approved by full auto (no stack change).
- 2026-10-14 S3: follow-up idea created for `board` in SSH cards: #25.

## Verification

- done (ALL PASS; posted to the item)
