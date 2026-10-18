---
item: 33
type: feature
title: 'Basic Git functionality'
status: draft
branch: claude/33-basic-git-branches
---

# Basic Git functionality

## Problem

The title bar shows the open workspace's folder and its current git branch, but the branch is only a label: to see other branches, switch, make a branch or sync with the remote, the user has to open a terminal and type git. After this ships, clicking the branch in the title bar opens a branch menu listing the local branches and, as their own section, the remote branches; clicking one switches to it, and the menu has New branch, Fetch, Pull and Push, each showing git's result in the menu.

Builds on the title bar's branch chip and the worktree cards' git plumbing (`src/core/worktrees.ts`: `execFile`, no shell, injected `Run`).

## Domain decisions

- **D1 – Where the menu is:** the branch chip in the title bar becomes a button (same look, plus a chevron) that opens the branch menu below it; Esc, a click outside, or running an action that ends the menu's purpose (switching, creating) closes it. The chip on board cards stays a plain label. Shown only where the title bar shows a branch today: local workspaces and local worktree cards; no chip, so no menu, outside a git repository or in SSH workspaces (D11). *Why:* the item asks to click the branch in the top bar.
- **D2 – Which folder:** the menu acts on what the title bar shows: an open worktree card's own worktree (its directory), else the workspace folder (also when a non-worktree card or a shell is open). *Why:* developer's answer (Q2): the chip and the menu must agree.
- **D3 – Live branch for worktree cards:** with a worktree card open, the title-bar chip shows the live branch of the card's directory (read like the workspace's, every 4 s and on focus), falling back to the card's saved branch until read. The card on the board keeps showing the branch it was created on. *Why:* after switching inside a worktree from the menu, the chip must show the result; the saved branch is only the worktree's origin and isn't used to remove it.
- **D4 – Local branches:** the menu's first section, *Local*, lists every local branch (`refs/heads`) sorted by name, the current one first and marked (check icon, `aria-current`). On a detached HEAD the chip reads `detached` as today and no branch is marked. Clicking another local branch runs `git switch <branch>`; clicking the current one does nothing. *Why:* developer's answer (Q1).
- **D5 – Remote branches:** below Local, one section per remote (titled by its name, e.g. `origin`), listing its branches (`refs/remotes/<remote>/*` without `HEAD`) sorted by name, shown without the remote prefix. Clicking `origin/feat`: when a local branch `feat` exists, switch to it (like D4); otherwise `git switch --track origin/feat` creates `feat` tracking it and switches. No remotes → no remote sections. The list is what the last fetch left (D8). *Why:* developer's answer (Q4).
- **D6 – Refusals change nothing:** when git refuses (uncommitted changes the switch would overwrite, a branch checked out in another worktree, a pull that can't fast-forward, a rejected push, no remote…), the menu stays open and shows git's message (its stderr's meaningful lines, trimmed to 400 characters) in an error line; nothing is stashed, discarded or forced. A switch that git allows with uncommitted changes (they carry over) just happens. *Why:* developer's answer (Q3).
- **D7 – New branch:** a *New branch* button opens a name field in the menu; Enter or *Create* runs `git switch -c <name>` from the current HEAD, which creates it and switches to it; Esc returns to the list. The name is checked with `git check-ref-format --branch` and against existing local branches before running; empty, invalid (`Not a valid branch name`) or taken (`Branch already exists`) names show the reason under the field and run nothing. *Why:* developer's answer (Q5); reuses the worktree branch checks.
- **D8 – Fetch:** `git fetch --all --prune`: every remote, removing remote branches deleted there. On success the menu's lists and ahead/behind refresh and a `Fetched` note shows. *Why:* developer's answer (Q7).
- **D9 – Pull and push:** Pull runs `git pull --ff-only` (a diverged branch is refused with git's message, D6). Push pushes the current branch: with an upstream, `git push`; without one, `git push --set-upstream origin <branch>` (no `origin` remote → git's error). Both are disabled on a detached HEAD. No force push. On success a note shows (`Pulled`, `Already up to date`, `Pushed`) and the menu refreshes. *Why:* developer's answer (Q6).
- **D10 – Ahead/behind:** when the current branch has an upstream, the menu header shows `↑<ahead> ↓<behind>` against it as of the last fetch (`git rev-list --left-right --count HEAD...@{upstream}`), `0`s included; without an upstream it reads `No upstream`. Not on the title-bar chip. *Why:* developer's answer (Q9).
- **D11 – Local only:** SSH workspaces and SSH cards get no branch menu (they show no branch today). *Why:* developer's answer (Q10).
- **D12 – Never prompts:** every git command runs in main through `execFile` (no shell) with `GIT_TERMINAL_PROMPT=0` and no askpass, and over SSH remotes in batch mode (ssh never asks for a password or passphrase; keys in an agent and credential helpers work as usual), stdin closed, and a 2-minute timeout. A command that would need a credential fails with git's message followed by `Set up an SSH key or a git credential helper for this remote.`; a timeout fails with `git timed out`. *Why:* developer's answer (Q8); a hidden prompt would hang the menu.
- **D13 – One at a time, busy state:** while a command runs the menu shows which one (`Fetching…`, `Pulling…`, `Pushing…`, `Switching…`) and disables every action; the menu can be closed meanwhile and the command still finishes. After any command (success or failure) the title-bar chip's branch is re-read at once. *Why:* git takes the index lock; double runs would only race.
- **D14 – Running cards untouched:** switching or pulling doesn't stop, restart or warn about running cards; their shells see the changed files as with a branch switch typed in a terminal. *Why:* the menu does what the user would type; Drovr never interrupts running cards (`docs/product.md`).
- **D15 – Main checks its input:** main runs git only in an absolute existing directory that is inside a git repository, only the commands above, with branch and remote names passed as single arguments after validation (`check-ref-format`; a remote branch must be one `for-each-ref` listed), never through a shell. IPC is accepted from the main frame only. contextIsolation, nodeIntegration and sandbox unchanged. *Why:* AGENTS.md.

## Acceptance criteria

Unless stated otherwise: a local workspace `repo` on a git repository with commits on `main` (checked out) and a local branch `feature`, cloned from a local bare repository `remote.git` as `origin`, which also has a branch `remote-only`; `repo`'s board is shown; the branch menu is opened by clicking the title-bar chip.

- **AC1 – Menu opens:** when the user clicks the chip `main`, then a menu shows a *Local* section with `main` (marked current) then `feature`, an `origin` section with `feature`, `main`, `remote-only`, and buttons New branch, Fetch, Pull, Push; Esc closes it and focus returns to the chip.
- **AC2 – Switch local:** when the user clicks `feature`, then the menu closes and the chip reads `feature` within 1 s, and `git -C repo branch --show-current` prints `feature`.
- **AC3 – Switch to remote branch:** when the user clicks `remote-only` under `origin`, then the chip reads `remote-only`, and its upstream is `origin/remote-only`. Clicking `origin`'s `feature` switches to the existing local `feature`.
- **AC4 – Refused switch:** given `feature` changes `a.txt` and `repo` has an uncommitted change to `a.txt` on `main`, when the user clicks `feature`, then the menu stays open with an error line containing `would be overwritten`, the chip still reads `main`, and the change is still in `a.txt`.
- **AC5 – New branch:** when the user picks New branch, types `topic/x` and presses Enter, then the chip reads `topic/x` and the branch points at the old HEAD; typing `feature` shows `Branch already exists`, typing `a..b` shows `Not a valid branch name`, and neither runs git.
- **AC6 – Fetch with prune:** given another clone pushed branch `new-one` to `remote.git` and deleted `remote-only` there, when the user clicks Fetch, then `origin` lists `new-one` and no longer lists `remote-only`.
- **AC7 – Ahead/behind:** given `main` tracks `origin/main`, another clone pushed 1 commit to `main` and `repo` has 2 local commits, after Fetch the header reads `↑2 ↓1`; a branch without upstream reads `No upstream`.
- **AC8 – Pull:** given `main` is 1 behind `origin/main` and 0 ahead, when the user clicks Pull, then `Pulled` shows and the header reads `↑0 ↓0`; given it diverged (↑1 ↓1), Pull shows git's refusal (contains `Not possible to fast-forward`) and HEAD is unchanged.
- **AC9 – Push:** given `topic/x` was just created with no upstream, when the user clicks Push, then `Pushed` shows, `remote.git` has `topic/x` at the same commit, and the header reads `↑0 ↓0`. Given the remote moved ahead (non-fast-forward), Push shows git's rejection and nothing is forced.
- **AC10 – No prompt:** given a remote `origin` whose URL needs credentials (an HTTP URL to a local server answering 401), when the user clicks Fetch, then within 10 s the error line ends with `Set up an SSH key or a git credential helper for this remote.` and nothing waits for input (unit: the env and arguments passed to git).
- **AC11 – Busy:** while a Fetch is running (a remote that delays), the menu shows `Fetching…` and every action is disabled.
- **AC12 – Worktree card:** given a worktree card on branch `card-1` is open, when the user opens the menu and switches to a new branch `card-2`, then the title-bar chip reads `card-2`, `git -C <worktree> branch --show-current` prints `card-2` and the workspace folder is still on `main`.
- **AC13 – Not shown:** an SSH workspace and a workspace folder outside a repository show no chip and no menu; a detached HEAD shows `detached` with Pull and Push disabled.
- **AC14 – Running card:** given a running card printing `drovr-marker`, switching to `feature` from the menu leaves it `Running` with `drovr-marker` shown.
- **AC15 – Core:** the git module's operations (list, switch, track, create, fetch, pull, push, ahead/behind, error mapping) pass Vitest on real throwaway repositories with a local bare remote.
- **AC16 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Branch menu and switching:** core git module (branch listing with remotes, switch, track, the no-prompt environment and error mapping), main IPC handlers and the typed preload API, the title-bar chip as a menu button, live branch for worktree cards, local and remote sections, switching with errors shown. Satisfies AC1, AC2, AC3, AC4, AC12, AC13, AC14, part of AC15.
2. **S2 – New branch:** the name field, validation and `switch -c`. Satisfies AC5, part of AC15.
3. **S3 – Fetch, pull, push and ahead/behind:** the three actions, busy state, notes, ahead/behind header, credential message and timeout. Satisfies AC6, AC7, AC8, AC9, AC10, AC11, AC15, AC16.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC5, AC12–AC14 | e2e `e2e/git.spec.ts` (repos made in a temp dir, `plainCards`) | open the workspace, click the chip, use the menu, check with `git -C` |
| AC6–AC9, AC11 | e2e `e2e/git.spec.ts` with a local bare remote and a second clone | Fetch/Pull/Push from the menu, compare refs in `remote.git` |
| AC10 | Vitest (env and args given to `Run`), e2e with a 401 HTTP server | Fetch against the 401 remote, read the error line |
| AC15 | Vitest `src/core/git.test.ts` on throwaway repos | `npm test` |
| AC16 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI |

## Stack changes

None. git was already a runtime requirement for worktree cards.

## Data and migrations

None. Nothing is saved; branches and ahead/behind are read from git each time.

## Out of scope

- SSH workspaces and SSH cards (D11).
- Stash, discard, force push, rebase pulls, merging, deleting or renaming branches, choosing the start point of a new branch, commit/staging UI.
- Credential entry (D12).
- Ahead/behind on the title-bar chip or board cards; periodic background fetch.

## Open questions

None.
