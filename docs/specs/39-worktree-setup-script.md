---
item: 39
type: feature
title: Setup script for new worktree cards
status: approved
branch: claude/39-worktree-setup-script
---

# Setup script for new worktree cards

## Problem

A worktree card gets a fresh checkout with the repository's ignored files copied in, but a fresh worktree often still needs dependencies installed (`npm ci`, `uv sync`) or a file copied before its agent can run tests. Today the user types that by hand in every new worktree card, after the agent has already started. After this ships, a local workspace has a **Worktree setup** command that every new worktree card runs in its own terminal before its startup command, with its output visible there; the agent starts only once the setup succeeded, and a failure shows on the card with a way to retry or skip it.

## Domain decisions

- **D1 – Stored on the workspace:** a workspace has `worktreeSetup`, a one-line command (`''` for none), edited as **Worktree setup** in the workspace dialog (create and edit), shown only for a local workspace (worktree cards are local only). Validated like a Custom startup command: trimmed, one line (no `\r` or `\n`); empty is allowed and means none. It also may not end with `;`, `&` or `|` (`Command can't end with ; & or |`), since D3 appends `&& …` to it and such a line would never report back. Saved in the state file (a file without it reads as `''`) and synced in the sync file like the workspace's shells. An SSH workspace keeps whatever value it has but never shows or uses it. *Why:* setup depends on the repository, which is the workspace; the item asks for it to sync like shells. Rejected: per-card entry in the New card form, an app-wide setting.
- **D2 – Copied to the card as pending:** a card created with **Own worktree** while its workspace's `worktreeSetup` is not empty gets `setup: <that command>` (its pending setup). Any other card has none. Editing the workspace's setup later changes new cards only, as with directory and host. *Why:* a card's start must not change under it; matches how cards copy workspace fields.
- **D3 – Runs in the card's own shell, before the startup command:** when a card with a pending setup starts (main pane only), Drovr types the setup line instead of the start line: `<setup> && "$DROVR_BIN/board" setup . ok || "$DROVR_BIN/board" setup . failed`, then Enter. Its output is the card's terminal output. The startup command is not typed then. *Why:* the user's login shell and PATH apply and the output is where the agent will run; `&&`/`||` and `"$VAR/x"` already work in every shell Drovr starts (bash, zsh, fish 3), as the existing start lines rely on. Rejected: running it in main in a hidden shell (output in a dialog); joining `<setup> && <startup>` (the card can't tell it failed).
- **D4 – `board setup <card> ok|failed`:** a new `board` subcommand, accepted from any pane of the card, only for the calling card (`.` or its own id or title; another card's gets the same error), for a card that is running and has a pending setup (else the error `board: <title> has no setup running`). Not listed in `board help` (it is Drovr's own plumbing, like a hook). `ok`: the card's pending setup is cleared (saved) and Drovr types the card's start line into the main pane as a normal start would (recording a first start of Claude Code or a preset exactly as `CardSessions.start` does). `failed`: the pending setup stays; nothing else is typed. *Why:* the board learns success or failure without parsing output; the agent never starts on a broken worktree.
- **D5 – Setup state on the card (runtime):** while a setup line has been typed and no answer came, the card shows a `Setting up` pill on its status row; after `failed`, a red `Setup failed` pill. Both in the activity pill's place, taking precedence over any activity; cleared on `ok`, on a retry or skip (D6), and whenever the card's shell stops or starts again. Never saved or synced. *Why:* same place and lifetime as activity (#31), which the user already reads.
- **D6 – Retry and Skip:** while a card shows `Setting up` or `Setup failed`, its board card's menu (the open card has no menu since #31) has **Retry setup** (types the setup line again, back to `Setting up`) and **Skip setup** (clears the pending setup, saved, and types the start line as D4's `ok` does). Neither is offered otherwise. While `Setting up` they type into the terminal like the user would, so they are meant for a setup the user stopped (Ctrl+C ends the whole line, so no answer comes) or one that can never answer (a `#` comment, an unclosed quote). *Why:* the shell stays open to inspect or fix things; Retry and Skip avoid a dead end without stopping the card.
- **D7 – Pending until it succeeds:** a pending setup runs on every start of the card until a run succeeds or is skipped: a card stopped (Close, its shell exiting, an app restart) while `Setting up` or `Setup failed` runs the setup again next time it is opened. *Why:* an interrupted `npm ci` leaves a broken worktree; rerunning a successful setup on every reopen would waste minutes.
- **D8 – Per machine:** the card's `setup` is saved in the state file but not written to the sync file; a card read from the sync file has none (like `claudeStarted` and `startedAgents` for local cards). *Why:* the worktree lives on the machine that made it.
- **D9 – Shown when creating:** in the New card form, with **Own worktree** checked and the workspace's setup not empty, the worktree hint names it: `Runs <setup> first`. *Why:* the user sees why the agent doesn't start at once.
- **D10 – No teardown:** removing a worktree runs nothing extra (out of scope). *Why:* keeps the item small; teardown would run in main without a terminal and need its own failure handling.

## Acceptance criteria

- **AC1 – Edit the setup:** Given a local workspace, when the user opens Edit workspace, types `npm ci` in **Worktree setup** and saves, then reopening the dialog shows `npm ci`, and after an app restart it still shows `npm ci`. Given an SSH workspace (Location: SSH), the dialog shows no Worktree setup field.
- **AC2 – One line:** Given the workspace dialog, when the user pastes `a\nb` into Worktree setup and saves, then the dialog shows `Command must be one line` under the field and nothing is saved. When the user types `npm ci;` and saves, the dialog shows `Command can't end with ; & or |` and nothing is saved.
- **AC3 – Runs before the agent:** Given a local git workspace with Worktree setup `echo SETUP-RAN > setup.txt` and a Custom startup `echo AGENT-STARTED`, when the user creates a card with Own worktree, then the card's terminal shows the setup line's output first, `setup.txt` exists in the card's worktree, and `AGENT-STARTED` is printed after it; the card shows no setup pill afterwards.
- **AC4 – Setting up pill:** Given Worktree setup `sleep 3`, when a worktree card is created, then within 1 s its board card shows `Setting up` and its menu offers Retry setup and Skip setup, and once the sleep ends the pill is gone, neither is offered, and the startup command runs.
- **AC5 – Failure:** Given Worktree setup `false`, when a worktree card is created, then the card shows a `Setup failed` pill, the startup command's output (`AGENT-STARTED`) never appears, and the card is still Running with its shell at a prompt.
- **AC6 – Retry:** Given a card showing `Setup failed` whose setup is `test -f ok.flag`, when the user creates `ok.flag` in the worktree from the card's terminal and picks **Retry setup** in its menu, then the pill goes from `Setting up` to none and `AGENT-STARTED` appears.
- **AC7 – Skip:** Given a card showing `Setup failed`, when the user picks **Skip setup**, then the pill is gone and `AGENT-STARTED` appears; after Close and reopen, no setup line is typed and `AGENT-STARTED` appears.
- **AC8 – Once only:** Given a worktree card whose setup succeeded, when the user closes and reopens it (and after an app restart), then only the startup command is typed.
- **AC9 – Rerun after an interrupted setup:** Given a worktree card showing `Setup failed` (or `Setting up`), when the app is restarted and the card opened, then the setup line is typed again.
- **AC10 – Only worktree cards:** Given a workspace with Worktree setup `echo SETUP-RAN`, when the user creates a card without Own worktree, or opens a workspace shell, then no setup line is typed; with an empty Worktree setup, a worktree card types only its startup command.
- **AC11 – Board command errors:** Given a running card with no pending setup, when `board setup . ok` is run in it, then it prints `board: <title> has no setup running` and exits 1; given a sibling card `B` with a pending setup, `board setup B ok` from another card gives `board: B has no setup running` and changes nothing; `board help` doesn't list `setup`.
- **AC12 – Sync:** Given two instances sharing a Sync folder, when the user sets Worktree setup `npm ci` on one, then the other's Edit workspace shows `npm ci`; the sync file has no `setup` field on any card.
- **AC13 – Hint:** Given a workspace with Worktree setup `npm ci`, when the user checks Own worktree in the New card form, then the hint reads `Runs npm ci first`.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Workspace field:** `worktreeSetup` on the workspace (store create/edit with validation, state file read with `''` default, sync file write/read), the Worktree setup field in the workspace dialog for local workspaces. Satisfies AC1, AC2, AC12 (workspace part).
2. **S2 – Pending setup and the setup line:** cards created with Own worktree copy `setup` (saved, not synced); `CardSessions.start` types the setup line in place of the start line when the card has a pending setup; `board setup <card> ok|failed` (CLI parsing, protocol, renderer handling: clear and save on `ok`, then type the start line with first-start recording); the error for a card with none; not in help; the New card hint. Satisfies AC3, AC7 (reopen part), AC8, AC9, AC10, AC11, AC12 (card part), AC13.
3. **S3 – Setup state on the card, Retry and Skip:** the runtime `Setting up` / `Setup failed` pill with its lifetime, and the card menu's Retry setup and Skip setup. Satisfies AC4, AC5, AC6, AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | Vitest (workspace-store, saved-state); e2e `e2e/worktree-setup.spec.ts` | Edit workspace, type, save, reopen; restart; SSH location hides the field |
| AC3 | Vitest (card-sessions: setup line typed instead of start line); e2e | Worktree card in a throwaway repo; read terminal and `setup.txt` |
| AC4, AC5 | Vitest (card-sessions setup state); e2e | Board card pill text |
| AC6, AC7 | e2e | Card menu items, terminal output |
| AC8, AC9 | Vitest (start line after `ok`); e2e with restart | Close/reopen, restart, read typed lines |
| AC10 | Vitest; e2e | Plain card and Default shell type no setup line |
| AC11 | Vitest (board-args, board-commands); e2e | `board setup . ok` in a plain card; `board help` |
| AC12 | Vitest (sync-file); e2e two instances | Second instance's dialog; sync file contents |
| AC13 | e2e | New card form hint |

## Stack changes

None.

## Data and migrations

- Workspace: `worktreeSetup: string` in the state file and the sync file; missing reads as `''`, so existing files load unchanged.
- Card: optional `setup: string` (pending setup) in the state file only; absent means none. Existing cards have none.

## Out of scope

- A teardown command when a worktree is removed (D10).
- Setup for cards without a worktree, for workspace shells, or in SSH workspaces.
- Showing the setup's exit code, or a timeout for a setup that hangs (the user can Close the card).
- Editing a card's own pending setup.

## Open questions

None.
