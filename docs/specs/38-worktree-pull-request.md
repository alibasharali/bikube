---
item: 38
type: feature
title: 'Open a pull request from a worktree card'
status: draft
branch: claude/38-worktree-pull-request
---

# Open a pull request from a worktree card

## Problem

A worktree card gives an agent its own branch, but shipping that branch still means leaving the board: push it in a terminal, find the repository on GitHub, open a pull request, check CI there, and merge the branch back by hand. After this ships, a worktree card's ⋯ menu has **Open pull request** (push the card's branch, then open GitHub's page for a new pull request, or the existing one, in the browser) and **Merge into `<branch>`** (merge the card's branch into the workspace folder's current branch locally), and the card shows its pull request's number and CI state when the user has `gh` installed and logged in. Drovr stores no GitHub token.

Builds on #33's git plumbing (the no-prompt git runner, `push`, `gitError`, main's per-folder queue, the live branch reads) and the worktree cards (`Card.worktree`). Uses the login-shell runner of #55 (opening a file in an editor) to find `gh` on the user's PATH.

## Domain decisions

- **D1 – Worktree cards only:** the menu items and the PR chip exist only on cards with their own worktree (`Card.worktree`), which are always local. Plain cards, shells and SSH cards get none of this. *Why:* the item; a worktree card is the one with a branch of its own.
- **D2 – The card's live branch:** every action uses the branch checked out in the card's worktree now (read as #33 D3 does, `symbolic-ref --quiet HEAD` in `worktree.path`), not the branch the card was created on, since the branch menu can switch it. On a detached HEAD both menu items are disabled (`aria-disabled`, title `Not on a branch`) and no PR chip shows. *Why:* what the user sees in the title bar is what gets pushed and merged.
- **D3 – Open pull request:** runs, in the card's worktree, #33's `push` (to the upstream with `git push`, else `git push --set-upstream origin refs/heads/<branch>`; never forced). When the push fails, git's message is shown (D6) and nothing opens. When it succeeds, main opens one URL in the default browser (`shell.openExternal`): the open pull request's page when one is known (D9), else GitHub's compare page `https://github.com/<owner>/<repo>/compare/<branch>?expand=1`, with no base so GitHub targets the repository's default branch (round 1 Q6). The note reads `Pushed · opened in the browser`. Main builds the URL itself; the renderer only asks for the card's folder. *Why:* round 1 Q1, round 2 Q4: no `gh` needed to open a PR.
- **D4 – GitHub remotes only:** the compare URL is built from the URL (`git remote get-url <remote>`) of the remote the branch was pushed to: its upstream's remote (`branch.<branch>.remote`), else `origin`. Accepted forms, all on host `github.com` only (case-insensitive, optional `.git` suffix, optional trailing `/`): `https://github.com/<owner>/<repo>`, `https://<user>@github.com/<owner>/<repo>`, `git@github.com:<owner>/<repo>`, `ssh://git@github.com/<owner>/<repo>` (port allowed). `<owner>` and `<repo>` must match `[A-Za-z0-9._-]+`. Any other URL: the push still happens and the card shows the error `Not a GitHub remote: open the pull request on its site`. In the compare URL each `/`-separated part of the branch is percent-encoded and the `/`s kept. *Why:* round 2 Q1: a guessed URL on an unknown host could be wrong.
- **D5 – No column move:** opening a PR or merging never moves the card; the user or the agent (`board move`) does. *Why:* round 1 Q5.
- **D6 – The card's action line:** while Open pull request or Merge runs, the card shows a line under its branch, `Pushing…` or `Merging…`, and both menu items are disabled; Delete and the rest of the menu stay usable. A success shows its note (`Pushed · opened in the browser`, `Merged <card branch> into <branch>`, `Already up to date`) for 10 s; a failure shows git's message (#33 D6: `gitError`, at most 400 characters) with a dismiss button (×, `aria-label="Dismiss"`) until dismissed or the next action. The line is kept per card outside the card component (the board remounts cards on moves and workspace switches) for the run of the app; nothing is saved. An action already running for the card ignores a second request. *Why:* round 2 Q2; the pattern of #33's `git-runs`.
- **D7 – PR status through `gh`:** main runs `gh pr view <branch> --json number,state,url,statusCheckRollup` in the card's worktree through the user's login shell (the same shell and argument handling as opening a file in an editor, #55 D15: `command -v "$1" … exec "$@"`, the branch a positional argument, fish's `$argv` variant), with `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1` added to main's environment, stdin closed, detached, and a 20 s timeout (the process group killed then). Any failure (gh missing, exit 127, not logged in, no PR for the branch, not a GitHub repository, a timeout, unparsable JSON, a `url` that isn't `https://github.com/…`) reads as *no PR* and shows nothing; no error is ever shown for it. *Why:* round 1 Q2: through the user's own `gh`, no token in Drovr.
- **D8 – The PR chip:** with a PR known, the card shows a chip `#<number>` beside its branch: for an open PR with a CI dot (`data-ci`): `passing` (green), `failing` (red), `pending` (amber), nothing when it has no checks; a merged PR reads `#<n> merged`, a closed one `#<n> closed`, without a dot. CI comes from `statusCheckRollup`: any check run whose `conclusion` is `FAILURE`, `CANCELLED`, `TIMED_OUT`, `ACTION_REQUIRED` or `STARTUP_FAILURE`, or status context whose `state` is `FAILURE` or `ERROR` → failing; else any check run not `COMPLETED` or context `PENDING`/`EXPECTED` → pending; else (all success, neutral or skipped) → passing; empty → none. The chip is a button of its own (not inside the card's open button); clicking it opens the PR's `url` in the browser through the existing link opening (`link:open`, http/https only) and never opens the card. Its tooltip reads `Pull request #<n>: <CI state or merged/closed>`. *Why:* round 2 Q3.
- **D9 – When it is read:** each shown worktree card's PR is read when the card is first shown, every 60 s while the window is focused, when the window gets the focus, right after Open pull request succeeds, and when its live branch changes; one read at a time per card, a read's result applied only if the card's branch is still the one read. Not read while the window is unfocused. With an open PR known, the menu item reads `Push and open pull request #<n>` and D3 opens that PR's `url`; with a merged or closed one it reads `Open pull request` and opens the compare page. *Why:* round 2 Q3, Q4; 60 s keeps many cards well within GitHub's API limits.
- **D10 – Merge into `<branch>`:** the item reads `Merge into <branch>`, where `<branch>` is the workspace folder's current branch (`worktree.repo`, read live as the sidebar reads it); it is disabled (title `The workspace folder is not on a branch`) when that folder is detached, not a repository or not read yet. Choosing it opens a confirmation: title `Merge branch`, message `Merge <card branch> into <branch> in <folder>?`, and, when the card's worktree has uncommitted changes (`git status --porcelain` there, untracked included), a second line `The card's uncommitted changes are not included: only its commits are merged.`; buttons `Merge` and `Cancel`. *Why:* round 1 Q3, Q4; round 2 Q5.
- **D11 – How the merge runs:** in the workspace folder (`worktree.repo`), queued with every other git command for that folder (#33 D13): first `git status --porcelain --untracked-files=no`; any output refuses with `The workspace folder has uncommitted changes: commit or stash them first` and runs nothing else (untracked files are left to git, which refuses itself if the merge would overwrite one). Then `git merge --no-edit refs/heads/<card branch>` (a full ref, so a name never reads as an option; fast-forwards when it can). On success the note is `Already up to date` when HEAD didn't move, else `Merged <card branch> into <branch>`. On a conflict (exit non-zero and `git diff --name-only --diff-filter=U` lists files), main runs `git merge --abort` and the error is `Merge conflict in <files, comma-separated, at most 5 then "and N more">: nothing was merged`; any other failure is git's message. The folder is left as it was before the merge whenever it fails. The workspace folder's branch chips are re-read at once after a merge. Running cards are untouched (#33 D14). *Why:* round 1 Q3; round 2 Q5.
- **D12 – Main checks its input:** the renderer sends only the card's worktree folder (and for a merge, the workspace folder and the branch it expects). Main accepts an absolute existing folder inside a git work tree (#33 D15); for a merge it reads the card's branch itself from the worktree folder and refuses with `The card's branch changed: try again` if it differs from what the renderer showed, and checks that the workspace folder's current branch is the one the confirmation named (else `The workspace folder's branch changed: try again`). Every git command goes through #33's no-prompt runner (no shell, stdin closed, 2-minute timeout, credential hint); `gh` only through D7's login shell. IPC from the main frame only. contextIsolation, nodeIntegration and sandbox unchanged. *Why:* AGENTS.md; the confirmation must merge exactly what it said.

## Acceptance criteria

Unless stated otherwise: a local workspace `repo` on a git repository with commits on `main` (checked out), whose `origin` has URL `https://github.com/acme/widget.git` and push URL a local bare repository `remote.git` (`remote.origin.pushurl`); a worktree card `Card 1` on branch `card-1` with one commit of its own; `shell.openExternal` stubbed and recording its URLs; a fake login shell `HOME` whose `.profile` puts a fake `bin` on PATH, which has a fake `gh` only where stated.

- **AC1 – Open pull request:** when the user picks `Open pull request` from `Card 1`'s ⋯ menu, then the card shows `Pushing…`, then `Pushed · opened in the browser`; `remote.git` has `card-1` at the card's commit, `card-1`'s upstream is `origin/card-1`, and the browser got `https://github.com/acme/widget/compare/card-1?expand=1`.
- **AC2 – Not GitHub:** given `origin`'s URL is `https://gitlab.com/acme/widget.git`, when the user picks Open pull request, then `remote.git` has `card-1` and the card shows `Not a GitHub remote: open the pull request on its site` with a Dismiss button that removes it; nothing opened.
- **AC3 – Push refused:** given `remote.git`'s `card-1` has a commit the card doesn't, when the user picks Open pull request, then the card shows git's rejection (contains `rejected`), nothing opened and nothing is forced.
- **AC4 – Live branch and detached:** given the branch menu switched `Card 1`'s worktree to a new branch `topic/x`, Open pull request pushes `topic/x` and opens `…/compare/topic/x?expand=1`; on a detached HEAD in the worktree both items are disabled.
- **AC5 – Compare URL rules (unit):** the URL builder accepts the D4 forms (`git@github.com:acme/widget.git`, `ssh://git@github.com:22/acme/widget`, `https://me@github.com/acme/widget/`) and refuses `https://github.com.evil.com/a/b`, `https://evil.com/github.com/a/b` and `git@gitlab.com:a/b`; `feat/ä b` becomes `feat/%C3%A4%20b`.
- **AC6 – PR chip:** given a fake `gh` answering an open PR 12 with one failing check run, when the board is shown, then `Card 1` shows chip `#12` with `data-ci="failing"` within 2 s; when the fake answers merged and the window gets the focus, the chip reads `#12 merged` within 2 s.
- **AC7 – Chip opens the PR:** clicking the chip `#12` opens its `url` (`https://github.com/acme/widget/pull/12`) in the browser, and the card stays on the board (not opened).
- **AC8 – No gh, no chip:** given no `gh` on PATH (or a `gh` exiting 1 with `no pull requests found`), no chip shows and no error line shows; the menu item reads `Open pull request`.
- **AC9 – Existing PR:** given the fake `gh` answers an open PR 12, the menu item reads `Push and open pull request #12`, and choosing it pushes and opens `https://github.com/acme/widget/pull/12`.
- **AC10 – CI states (unit):** the rollup parser gives `failing`, `pending`, `passing` and none for the D8 cases (a `CANCELLED` conclusion, an `IN_PROGRESS` run, a `SUCCESS` run plus a `SKIPPED` one, an `ERROR` context, an empty rollup), and the gh runner's arguments keep the branch a positional argument with the D7 environment.
- **AC11 – Merge:** when the user picks `Merge into main` and confirms, then the card shows `Merged card-1 into main`, `git -C repo log -1 --format=%s main` is the card's commit message (fast-forward) and the card is still running; merging again shows `Already up to date`.
- **AC12 – Merge refused when dirty:** given `repo` has an uncommitted change to a tracked file, when the user confirms Merge, then the card shows `The workspace folder has uncommitted changes: commit or stash them first` and `main` didn't move; an untracked file alone doesn't block it.
- **AC13 – Merge conflict aborted:** given `main` and `card-1` both changed line 1 of `a.txt`, when the user confirms Merge, then the card shows `Merge conflict in a.txt: nothing was merged`, `git -C repo status --porcelain` is empty and `main` didn't move.
- **AC14 – Merge confirmation:** given `Card 1`'s worktree has an uncommitted file, the confirmation shows `Merge card-1 into main in <repo>?` and the line about uncommitted changes; Cancel runs nothing. Given `repo` is detached, `Merge into …` is disabled.
- **AC15 – Not offered:** a plain card and an SSH card have neither menu item nor chip.
- **AC16 – Core:** the merge, the remote URL and the push-then-URL steps pass Vitest on real throwaway repositories with a local bare remote.
- **AC17 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Open pull request:** the GitHub URL parser and compare URL builder, the push-then-URL core step on #33's `push`, main's IPC handler (queued per folder, main frame only, `shell.openExternal`), the typed preload API, the worktree card's menu item with the live branch, and the card's action line (busy, note, error, Dismiss). Satisfies AC1, AC2, AC3, AC4, AC5, AC15, part of AC16.
2. **S2 – PR chip through gh:** the gh runner on the login shell and the rollup parser in core, main's IPC handler, the renderer's per-card PR store (reads on show, 60 s while focused, on focus, after Open pull request, on branch change), the chip and its click, and the `Push and open pull request #<n>` label. Satisfies AC6, AC7, AC8, AC9, AC10.
3. **S3 – Merge into the workspace branch:** the merge core step (dirty check, merge, conflict abort, notes), main's IPC handler with D12's checks, the menu item with the workspace folder's live branch, the confirmation with the uncommitted-work line, and re-reading branch chips after. Satisfies AC11, AC12, AC13, AC14, AC16, AC17; adds the new smoke spec to AGENTS.md's list.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC4, AC15 | e2e (new `e2e/pull-requests.spec.ts`: repo with a github.com URL and a local `pushurl`, `plainCards`, `shell.openExternal` stubbed) | create a worktree card, commit in it, pick Open pull request, check `remote.git` and the recorded URL |
| AC5 | Vitest on the URL parser | `npm test` |
| AC6–AC9 | e2e with a fake `gh` (a shell script printing the JSON a file holds) on the fake login shell PATH | show the board, read the chip, focus the window, click the chip |
| AC10 | Vitest on the rollup parser and the gh plan's arguments and env | `npm test` |
| AC11–AC14 | e2e on the same repo | pick Merge, confirm, check `git -C repo` |
| AC16 | Vitest on throwaway repositories with a local bare remote | `npm test` |
| AC17 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI |

## Stack changes

None. `gh` is optional and the user's own (like the editors of #55); git was already required.

## Data and migrations

None. The action line and PR status live in memory for the run of the app; nothing is added to the state file or sync.

## Out of scope

- Creating the PR without the browser (`gh pr create`), choosing its base, title or body (round 1 Q1, Q6).
- Non-GitHub hosts and GitHub Enterprise (D4).
- Merging the PR on GitHub, pushing the merged workspace branch, deleting the card's branch or worktree after a merge.
- Moving the card to a column on PR open or merge (D5).
- PR actions in the title-bar branch menu, for plain cards or for SSH workspaces (D1).
- Showing why `gh` gave nothing (D7).

## Open questions

None.
