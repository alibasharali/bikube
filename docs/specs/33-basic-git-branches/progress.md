# Progress #33 Basic Git functionality

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `81bc2f5..18d8dcf` | fixed r1 (key on board chip; keep user's ssh command) | core `src/core/git.ts`: `gitIn(runner, base)`, `gitEnv(base, sshCommand?)`, `listBranches`, `switchBranch`, `trackBranch`, `validBranchName`, `gitError`, `GIT_TIMEOUT_MS`, `CREDENTIAL_HINT`; IPC `git:branches`/`git:switch`/`git:track` (`window.drovr.git`); renderer `BranchMenu.tsx` `BranchChip`, testids `branch-menu`, `branch-busy`, `branch-error`, `branch-item`, `branch-new`, `branch-fetch`, `branch-pull`, `branch-push`; actions take optional `run` (disabled without), `needsBranch` for Pull/Push, `act(label, command)`; `refreshBranch(dir)` in `branches.ts` |
| S2 | done | `dc2b315..db5f3b5` | CLEAN | core `createBranch(dir, name, run): Promise<NewBranchResult>` (`{ok:true} \| {ok:false; reason; name?: true}`); IPC `git:create`, `GitApi.create(dir, name)`; `act()` takes `GitResult \| NewBranchResult`; testids `branch-new-name`, `branch-new-create`, `branch-new-problem`; busy `Creating…`; Fetch/Pull/Push still without `run` |
| S3 | running | | | |

## Rulings

None yet.

## Verification

- todo
