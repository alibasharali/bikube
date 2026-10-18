# Progress #38 Open a pull request from a worktree card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `75e5f3f..48ab352` | CLEAN | core `src/core/pull-requests.ts`: `githubRepository`, `compareUrl`, `pushForPullRequest(dir, git)` → `{ok,url}`/`{ok:false,reason}`, `NOT_GITHUB`, `OPENED_NOTE`; IPC `git:openPullRequest` in `registerGit` (main opens URL, returns `SyncResult`); preload `window.drovr.git.openPullRequest(dir)`; renderer `src/renderer/src/card-git.ts`: `runCardGitAction(cardId, label, fn)` (null while busy), `dismissCardGitAction`, `useCardGitAction`; `CardGitActionLine` (testid `card-action`), `PullRequestItem` (testid `card-menu-pull-request`) uses `useBranch(worktree.path)` |
| S2 | done | `19c865f..d719689` | fixed r1 | core `src/core/pr-status.ts`: `ciState`, `parsePullRequest`, `ghPlan`, `ghEnv`, `readPullRequest`, `PullRequestStatus`, `PullRequestRead`; `pushForPullRequest(dir, git, openPullRequest?)`; IPC `git:pullRequest` → preload `window.drovr.git.pullRequest(dir)`; `registerGit(shellSetting)`; renderer `src/renderer/src/pull-requests.ts`: `usePullRequest(dir, liveBranch)`, `refreshPullRequest(dir)`; chip testid `card-pr`; card grid rows: chip 2, action line 3, status 4 |
| S3 | done | `b3eadd7..81f1325` | CLEAN | core `src/core/merges.ts` `mergeCardBranch`; IPC `git:merge` → `window.drovr.git.merge(dir, repo, cardBranch, branch)`; `ConfirmDialog.detail`; `MergeCardDialog` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-18 S2 (full auto): gh runs as `gh pr view --json … -- <branch>`; chip on its own line under the branch; only the 60 s poll skipped while unfocused; main opens the PR URL from its own last gh read → spec D7–D9 updated (`docs(spec)` commit).

## Verification

- running
