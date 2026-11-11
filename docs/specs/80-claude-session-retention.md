---
item: 80
type: feature
title: Claude code session retention period
status: approved
branch: claude/80-claude-session-retention
---

# Claude code session retention period

## Problem

Claude Code deletes conversation transcripts older than `cleanupPeriodDays` (30 by default) whenever any `claude` process starts. A Bikube Claude Code card left for 30 days then can't resume: today its start line (`--resume <id> || --session-id <id>`) silently falls back to a fresh, empty conversation under the same id, and the card's history is lost without a word. After this ships Bikube offers, once, to raise Claude Code's retention to 3650 days in `~/.claude/settings.json`, keeps its own copy of every local Claude Code card's transcript and puts it back before a resume when Claude Code deleted it, and never silently starts a card fresh when its conversation is gone: it asks.

## Domain decisions

- **D1 – Two protections, no handoff text:** Bikube (a) offers to set `cleanupPeriodDays` in the user's Claude settings and (b) backs up and restores transcripts. It does not keep a separate "short context" per card or pass one as a prompt. *Why:* the developer picked these two in round 1; a restored transcript is the real conversation, and the setting stops the deletion at its source for every `claude` run, including ones Bikube didn't start.
- **D2 – Where the setting goes:** `cleanupPeriodDays` is written to `~/.claude/settings.json` (user settings; `~` is `BIKUBE_HOME_DIR` else the OS home), never to Bikube's own `--settings` file or a workspace's `settings.local.json`. *Why:* Claude Code's cleanup runs at the start of any `claude` process and reads user (and managed policy) settings for it; a value only in Bikube's `--settings` file would be ignored by every `claude` the user runs elsewhere.
- **D3 – The value:** 3650 (about ten years, Claude Code's own suggestion). The setting is "low" when `~/.claude/settings.json` has no `cleanupPeriodDays` or a number below 3650; a value of 3650 or more is left alone. A non-number value, an unreadable or invalid file, or a file that is a link reads "unknown" and is never offered or written. *Why:* developer's answer (Q3); a user who set more than 3650 chose more.
- **D4 – Writing the user settings file:** the same rules as Agent setup's `settings.local.json` writer: the file re-read just before writing, only `cleanupPeriodDays` set (every other key and their order kept), 2-space JSON with a final newline written to a `.tmp` beside it and renamed over it, `~/.claude/` created when missing, a missing file created as `{ "cleanupPeriodDays": 3650 }`. Invalid JSON, a non-object, a link (the file or `~/.claude`) or a non-regular file writes nothing and returns the reason as the error line (`Couldn't save: settings.json is not valid JSON`, `Couldn't save: settings.json is a link`). Main does the write (main frame only); the renderer only asks for "set retention", never a path or a value. *Why:* the writer's guarantees already passed review for #68; refusing links keeps a dotfiles symlink intact (the user can set it in their dotfiles).
- **D5 – The one-time notice:** when a local Claude Code card is opened (the card view, in the main window or a card window) while the setting reads "low" and the `offerClaudeRetention` preference is on, a banner shows at the top of the card view, not a modal (the terminal keeps its keys): `Claude Code deletes conversations after <n> days, so this card can't resume after that.` (`<n>` the set value, or `30` when unset) with **Keep for 10 years** (writes D2/D3, then the banner goes), **Not now** (hidden for the rest of this run of the app, on every card) and **Don't ask again** (saves `offerClaudeRetention: false`). A failed write keeps the banner with D4's error line under its text. The setting is read when such a card is opened, at most once every 30 s. *Why:* developer's answer (Q2: a one-time notice plus Agent setup afterwards); a banner doesn't take the keyboard from a running agent.
- **D6 – The preference:** `offerClaudeRetention` (default on) in `Preferences`, written to `bikube-settings.json` only when off. Settings shows it as a switch `Offer to keep Claude Code conversations` beside the Claude Code status switch. *Why:* the existing preference table, and a way back after Don't ask again (as Ask before closing has).
- **D7 – Agent setup afterwards:** while the setting reads "low", Agent setup (any local workspace) lists a warning in Overview's Warnings and on Config's `cleanupPeriodDays` row (or a row added for it when no settings file sets it): `Claude Code deletes conversations older than <n> days; Bikube cards can't resume them after that.`, with a **Keep for 10 years** button doing D5's write. It shows whatever `offerClaudeRetention` says. After a write the page's next read shows the row at 3650 from User and no warning. *Why:* developer's answer (Q2).
- **D8 – What is backed up:** a local Claude Code card's current conversation (startup `claude`, no host; worktree cards included, from their worktree folder): the transcript `<home>/.claude/projects/<encodeProjectFolder(folder)>/<agentSessionId>.jsonl` and, when present, the folder `<agentSessionId>/` beside it (subagent transcripts and tool results). The folder is the card's directory, where its `claude` runs (for a worktree card its worktree folder or a folder inside it, as the Agent tab reads it). SSH cards, plain cards, presets (Codex, Gemini…) and workspace shells are out (Q6). *Why:* `--resume` needs the transcript; the folder beside it is what the Agent tab and Claude Code read for subagents.
- **D9 – When it is backed up:** after each `board usage` the card reports (Claude Code's Stop and SessionStart hooks run it, so after every turn and at each start) and when the card's main pane stops (exit, Close, quit), as the renderer learns of it. A copy is made only when the transcript's size or mtime differs from the last copy's; a missing transcript copies nothing and leaves the backup as it was. *Why:* developer's answer (Q4); the hook already fires per turn, and comparing size and mtime keeps a long session from copying megabytes on every turn without changes.
- **D10 – Where backups live:** `<userData>/transcripts/<sha256 of the card id>/` (0700, files 0600), holding `<session id>.jsonl` and `<session id>/`, each written to a `.tmp` and renamed. Only the card's current session is kept: backing up a new session id (after `board session` changed it) removes the old one's files. Deleted with the card, pruned at launch to the cards on the board (as kept output, #46), never in the state file or the Sync folder. Main alone owns them (main frame only IPC); the renderer names a card id, its folder and its session id, main checks the folder is an absolute existing directory and the id a UUID before reading anything. *Why:* kept output's proven layout; a card's backup is this machine's.
- **D11 – Restore before resume:** before a local Claude Code card with `claudeStarted` types its resume line, the renderer asks main to prepare the conversation: transcript present → start as today; transcript missing and a backup of that session id exists → main copies the backup (transcript and folder) back into `~/.claude/projects/<encoded folder>/` (created when missing, never overwriting a file that appeared meanwhile) and the card starts as today, resuming it; transcript missing and no backup → D12. A failed check (IPC error, a refused folder) starts the card as today. Cards that haven't started Claude Code (`claudeStarted` false) skip the check. *Why:* the restore must happen before `claude --resume` reads the file; failing open keeps a broken check from blocking every card.
- **D12 – Conversation gone: ask, don't start:** the card isn't started; it shows Stopped on the board, and its card view shows (in place of the terminal, as a pending worktree's failure does) `This card's Claude Code conversation isn't on this machine. Claude Code deletes conversations after <n> days, or it ran on another machine.` with **Start a new conversation** and **Back**. Start a new conversation clears the card's `claudeStarted` and starts it, so it types the first-start line (`--session-id <id> || --resume <id>`, with #69's first prompt when it has a description) under the same session id; Back goes back to the board and leaves it Stopped. Opening it again checks again. *Why:* developer's answer (Q5: don't start; ask the user). The wording covers a synced card whose conversation lives on the other machine, which would otherwise read as a deletion.
- **D13 – The fake `claude`:** the smoke tests' fake `claude` writes a one-line transcript at `$HOME/.claude/projects/<encoded cwd>/<id>.jsonl` when it reports its session, so existing resume tests keep finding a conversation. *Why:* every resume test would otherwise hit D12.

## Acceptance criteria

- **AC1 – Notice shows:** Given a fake home whose `.claude/settings.json` is `{"model":"opus"}`, when a new local Claude Code card is created and opened, then a banner reads `Claude Code deletes conversations after 30 days, so this card can't resume after that.` with Keep for 10 years, Not now and Don't ask again, and the terminal still takes typed keys.
- **AC2 – Keep for 10 years:** Given AC1's banner, when Keep for 10 years is clicked, then `.claude/settings.json` reads `{\n  "model": "opus",\n  "cleanupPeriodDays": 3650\n}\n`, the banner is gone, and opening another Claude Code card shows none. With no `.claude` folder in the home, the click creates `.claude/settings.json` holding only `cleanupPeriodDays: 3650`.
- **AC3 – Not now and Don't ask again:** Given AC1's banner, Not now hides it and opening a second Claude Code card shows none; after a restart it shows again. Don't ask again hides it, writes `"offerClaudeRetention": false` to `bikube-settings.json`, and after a restart it doesn't show; Settings' `Offer to keep Claude Code conversations` switch turned on brings it back on the next open.
- **AC4 – Left alone:** Given `.claude/settings.json` with `cleanupPeriodDays: 5000`, or with invalid JSON, or a plain card or an SSH Claude Code card, then no banner shows. Given a `.claude/settings.json` that is a symlink with `cleanupPeriodDays: 30`, no banner shows and the file is unchanged.
- **AC5 – Write refused:** Given the banner showing and `.claude/settings.json` then replaced with `{ nope`, when Keep for 10 years is clicked, then the file is unchanged and the banner shows `Couldn't save: settings.json is not valid JSON`.
- **AC6 – Agent setup:** Given `.claude/settings.json` with `cleanupPeriodDays: 30`, when Agent setup is opened, then Overview's Warnings and Config's `cleanupPeriodDays` row show `Claude Code deletes conversations older than 30 days; Bikube cards can't resume them after that.` with Keep for 10 years; clicking it shows the row `3650` from User with no warning, also with `offerClaudeRetention` off.
- **AC7 – Backup per turn:** Given a running local Claude Code card whose transcript exists in the fake home, when `board usage . <transcript>` is typed in it, then `<userData>/transcripts/<sha256 card id>/<id>.jsonl` equals the transcript (folder 0700, file 0600), and after a line is appended and `board usage` runs again, it equals the longer file; a `<id>/subagents/agent-a.jsonl` beside the transcript is copied too.
- **AC8 – Backup at stop:** Given AC7's card, when a line is appended to the transcript and the card is closed, then the backup holds the line.
- **AC9 – Restore:** Given AC7's backed-up card stopped and its transcript (and `<id>/` folder) deleted, when the card is opened, then the transcript is back with the backup's content before the fake `claude` logs `--resume <id>`, and the card runs.
- **AC10 – Gone, ask:** Given a stopped local Claude Code card with `claudeStarted` and neither a transcript nor a backup, when it is opened, then no shell starts, the board shows it Stopped, and the card view shows `This card's Claude Code conversation isn't on this machine.` with Start a new conversation and Back. Back returns to the board with the card Stopped. Start a new conversation starts it and the fake `claude` logs `--session-id <id>` (with #69's first prompt when it has a description).
- **AC11 – Backups' lifetime:** Given a backed-up card, when it is deleted, its backup folder is gone; a backup folder of a card not on the board is removed at launch; neither `bikube-state.json` nor a Sync folder's `bikube-board.json` mentions `transcripts`; a new session id reported by `board session .` followed by `board usage` leaves only the new session's files.
- **AC12 – Not for others:** Given an SSH Claude Code card, a Codex card and a plain card, none is backed up and none shows AC10's panel; a Claude Code card that never started Claude Code (`claudeStarted` false) starts at once with no check.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Retention setting read and write:** core module reading `~/.claude/settings.json`'s `cleanupPeriodDays` into low / ok / unknown (D3) and writing 3650 with D4's rules (fs injected, Vitest on temp folders); main IPC to read and set it (main frame only, home from `BIKUBE_HOME_DIR`); `offerClaudeRetention` in `Preferences` with its Settings switch (D6); the card view banner with its three buttons (D5), in the main window and card windows. Satisfies AC1, AC2, AC3, AC4, AC5.
2. **S2 – Agent setup warning:** the warning in `setupWarnings` / Overview and on Config's row, its Keep for 10 years button through S1's IPC (D7). Satisfies AC6.
3. **S3 – Transcript backups:** core backup store (fs injected: copy when size or mtime changed, current session only, `.tmp` and rename, 0700/0600, delete, prune) and main IPC; the renderer backing up after each `board usage` of a local Claude Code card and when its main pane ends, deleting with the card and pruning at launch (D8–D10); the fake `claude` writing its transcript (D13). Satisfies AC7, AC8, AC11.
4. **S4 – Restore or ask before resume:** main's prepare call (present / restored / missing, D11) and the renderer's `startCard` running it for local Claude Code cards with `claudeStarted` before the start, as a pending worktree is made first; the card view's gone panel with Start a new conversation (clearing `claudeStarted`) and Back (D12). Satisfies AC9, AC10, AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC5 | Vitest for the read/write module (temp folders: missing, invalid, link, non-object, other keys kept); e2e `e2e/claude-retention.spec.ts` with the fake `claude` home (`BIKUBE_HOME_DIR`) | Open a Claude Code card with a fake home; click each banner button; read the settings files |
| AC6 | Vitest on `setupWarnings`/config rows; e2e in `e2e/agent-setup.spec.ts` | Agent setup > Overview and Config with `cleanupPeriodDays: 30`, click Keep for 10 years |
| AC7, AC8, AC11 | Vitest for the backup store (temp folders, injected fs); e2e in `e2e/claude-retention.spec.ts` typing `board usage .` | Card with a fixture transcript; type `board usage .`; read `<userData>/transcripts` |
| AC9, AC10, AC12 | Vitest for the prepare decision; e2e with the fake `claude` log | Delete the transcript, reopen the card; delete the backup too, reopen; click each button |

Existing resume tests (`e2e/startup.spec.ts` AC3, AC4, AC5, #31 AC12; `e2e/persistence.spec.ts` AC4; `e2e/sync.spec.ts` AC6's local card) depend on D13's fake transcript; `startup.spec.ts` AC5 ("nothing to resume starts fresh with the same session id") changes to AC10's panel and its Start a new conversation; `sync.spec.ts` AC6's local card on machine B is unchanged, since sync gives local cards `claudeStarted: false` on the other machine (#13 D6), so they skip the check (D11, AC12). Update them in the slice that changes their behaviour (S4), and AGENTS.md's test list with the new spec file.

## Stack changes

None.

## Data and migrations

- `Preferences.offerClaudeRetention` (boolean, default true; written only when false).
- `<userData>/transcripts/<sha256 card id>/` backups, this machine's only. No card field is added; D12 clears the existing `claudeStarted`. Existing cards get their first backup at their next turn or stop; a card whose conversation was already deleted before this ships gets D12's panel.

## Out of scope

- A per-card "short context" or handoff prompt (Q1 option not picked).
- SSH Claude Code cards and other agents' sessions (Q6).
- Managed policy settings: a `cleanupPeriodDays` set by policy is not read or offered.
- A setting to switch backups off, or a size limit on them.
- Backing up conversations of `claude` runs in workspace shells or extra panes.

## Open questions

