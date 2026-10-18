# Progress #38 Open a pull request from a worktree card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `75e5f3f..48ab352` | CLEAN | core `src/core/pull-requests.ts`: `githubRepository`, `compareUrl`, `pushForPullRequest(dir, git)` → `{ok,url}`/`{ok:false,reason}`, `NOT_GITHUB`, `OPENED_NOTE`; IPC `git:openPullRequest` in `registerGit` (main opens URL, returns `SyncResult`); preload `window.drovr.git.openPullRequest(dir)`; renderer `src/renderer/src/card-git.ts`: `runCardGitAction(cardId, label, fn)` (null while busy), `dismissCardGitAction`, `useCardGitAction`; `CardGitActionLine` (testid `card-action`), `PullRequestItem` (testid `card-menu-pull-request`) uses `useBranch(worktree.path)` |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- None yet.

## Verification

- todo
