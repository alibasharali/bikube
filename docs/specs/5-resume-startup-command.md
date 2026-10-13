---
item: 5
type: feature
title: Resume and startup command
status: approved
branch: claude/5-resume-startup-command
---

# Resume and startup command

## Problem

Since #4 every card is a login shell that dies for good when it exits: to get back into a coding agent's conversation the developer has to make a new card, remember the agent's session id and type the resume command by hand. After this ships each card has a startup command (Shell, Claude Code, or a custom command), and a card whose shell isn't running starts again in its own directory the next time it is opened, landing the developer back in the same agent conversation. Keeping old scrollback or non-agent shell state is not a goal. The persistence item later reuses the same "open a card that isn't running, it resumes" path after Drovr or the Mac restarts.

## Domain decisions

- **D1 – Scope:** restarting cards whose shell has stopped inside the running app. Cards are still lost on quit or reload (#4 D16); the persistence item only has to store each card's startup command, agent session id and started flag (D4) to make the same resume work after a relaunch. *Why:* round 1 Q1.
- **D2 – Startup command:** every card has one of three startup commands:
  - **Shell**: nothing is typed; the card is just the login shell (today's behaviour).
  - **Claude Code**: Drovr runs Claude Code with the card's agent session id (D4, D5).
  - **Custom**: a free-form one-line command (trimmed, required: empty gives `Command is required`), run as written on every start. The user writes one that resumes on its own, e.g. `codex resume --last`.
  *Why:* round 1 Q2, round 2 Q6. The developer would like Drovr to resume other agents without the user writing anything; that is deferred (Open questions).
- **D3 – How it runs:** a start is always the login shell in the card's directory (#4 D3). Right after the shell is spawned, Drovr writes the startup command followed by Enter (`\r`) into the terminal, as if typed, before any keystroke from the user. When the agent quits, the user is at a shell prompt in the same directory and the card stays `Running`. Shell writes nothing. *Why:* round 1 Q3.
- **D4 – Agent session id:** every card gets a random UUID (v4) at creation, its agent session id, kept for the card's whole life whatever its startup command, so switching a card away from Claude Code and back resumes the same conversation. The card also records whether Claude Code has been started with that id (`claudeStarted`, false at creation). *Why:* round 2 Q7; the flag picks `--session-id` vs `--resume`.
- **D5 – Claude Code command:** the first time a card starts Claude Code: `claude --session-id <uuid>`; writing it sets `claudeStarted`. Every later start: `claude --resume <uuid> || claude --session-id <uuid>`, so a conversation that never got a message (nothing to resume) starts fresh with the same id and the card always comes back with Claude running. *Why:* round 1 Q2, Q6.
- **D6 – Stopped:** when a card's shell exits, the card is `Stopped`: the status reads `Stopped` with no last output line (the exit code is dropped), and its old screen and scrollback are discarded. If the card is open at full size when its shell exits, the view goes back to the board. Stopped replaces #4's `Exited (code N)` / `Exited (signal N)` and the read-only exited view (#4 D9, D11). *Why:* round 1 Q5, round 2 Q2: an exited card shows nothing and resumes when opened.
- **D7 – Opening starts it:** opening a card (click, Enter, or right after creation) whose shell isn't running, i.e. Stopped, Couldn't start, or with no terminal yet, starts it: a new, empty screen, the login shell in the card's directory, then the startup command (D3) with the card's current settings. Opening a running card shows it as it is (#4 D10); `Back` keeps it running (#4 D8; this is the "minimize", round 2 Q1). Creating a card still starts and opens it at once (#4 D6) through this same path. *Why:* round 1 Q5, round 2 Q1.
- **D8 – Couldn't start:** a card that couldn't start (#4 D3) tries again every time it is opened; if that fails again, the status stays `Couldn't start: <reason>` with the reason shown in the view, as today. A failed start never retries on its own while the view stays open. *Why:* round 2 Q3.
- **D9 – Choosing at creation:** `+ New card` shows, next to the title input, a select with `Shell`, `Claude Code` and `Custom…`, preset to the workspace's default (D10). Choosing `Custom…` shows a `Command` field below, prefilled with the workspace's custom command when that is the default. Enter in the title or the command field creates the card; Esc cancels; moving focus between the title, select and command field doesn't cancel; clicking elsewhere with an empty title and the default command unchanged cancels (as #4 D4). Title rules are unchanged (#4 D5). *Why:* round 2 Q4.
- **D10 – Workspace default:** each workspace has a default startup command, set with a `Startup command` field (same three choices and `Command` field) in the workspace create and edit dialogs; `Shell` for a new workspace. It is only the preset for new cards: changing it never changes existing cards. *Why:* round 1 Q4, round 2 Q5.
- **D11 – Changing a card's command:** the card menu gets `Startup command…`, which opens a dialog titled `Startup command` with the same choices, the card's current command selected, the hint `Used the next time this card starts.`, and `Save` / `Cancel`. Saving changes only the setting: a running card keeps running untouched; the new command runs at its next start. *Why:* round 1 Q4.
- **D12 – Tag:** a card running Claude Code shows a small `Claude` tag on the board, a Custom card a `Custom` tag whose tooltip is the command; Shell cards show none. The tag follows the card's setting (D11), not what happens to be running. *Why:* round 2 Q8.
- **D13 – Deletes:** a Stopped card is deleted without confirmation and isn't counted as running in the workspace-delete confirmation, like #4's exited cards (#4 D13, D15). *Why:* it has no process.
- **D14 – Security boundaries unchanged:** the startup command goes through the existing `terminal:write` channel after `terminal:spawn`; no new IPC channel, and `terminal:spawn` keeps its arguments. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md; the renderer can already type anything into its own terminals.

## Acceptance criteria

Workspace `alpha` has working directory `/tmp/drovr-alpha` (an existing directory), the default columns and default startup command `Shell`, unless stated otherwise. A fake `claude` on the login shell's `PATH` appends its arguments as one line to `/tmp/drovr-claude.log`, prints `fake-claude <args>`, and waits for a line on stdin before exiting 0; with `FAKE_CLAUDE_RESUME_FAILS=1` in its environment, `--resume` exits 1 at once. `<U>` is the card's agent session id.

- **AC1 – Shell by default:** Given `alpha`'s board, when the user clicks `+ New card` under `Backlog`, then the select next to the title reads `Shell`; creating card `sh` opens it with the login shell running and nothing typed into it, and `sh` shows no tag on the board.
- **AC2 – Claude Code first start:** Given `alpha`'s board, when the user creates card `agent` with `Claude Code` selected, then the terminal shows the command `claude --session-id <U>` was run, where `<U>` is a UUID v4, the log's last line is `--session-id <U>`, the status reads `Running`, and on the board `agent` shows the tag `Claude`.
- **AC3 – Stopped:** Given card `agent` open with the fake claude running, when the user presses Enter (claude quits, the card stays `Running` at a shell prompt in `/tmp/drovr-alpha`) and then types `exit`, then the board is shown and `agent`'s status reads `Stopped` with no last output line.
- **AC4 – Resume on open:** Given card `agent` Stopped after AC3, when the user opens it, then the screen has none of the earlier output, `claude --resume <U> || claude --session-id <U>` was run in `/tmp/drovr-alpha` with the same `<U>`, the log's last line is `--resume <U>`, and the status reads `Running`.
- **AC5 – Nothing to resume:** Given card `agent` Stopped after AC3 and `FAKE_CLAUDE_RESUME_FAILS=1`, when the user opens it, then the log's last two lines are `--resume <U>` and `--session-id <U>` and the fake claude is running.
- **AC6 – Shell card restarts:** Given shell card `sh` where the user ran `exit 3`, then `sh` reads `Stopped` on the board; opening it starts a new shell where `pwd` prints `/tmp/drovr-alpha`, with nothing typed into it.
- **AC7 – Custom:** Given `alpha`'s board, when the user creates card `c` with `Custom…` and command `echo drovr-custom`, then the terminal prints `drovr-custom`, and `c` shows the tag `Custom` with tooltip `echo drovr-custom`; after `exit` and reopening, it prints `drovr-custom` again. Creating with `Custom…` and an empty command shows `Command is required` and creates no card.
- **AC8 – Workspace default:** Given the create-workspace dialog, then `Startup command` reads `Shell`. Given card `sh` (Shell) in `alpha`, when the user edits `alpha` to `Claude Code`, then `+ New card` is preset to `Claude Code`, and `sh` still has no tag and, after `exit` and reopening, still starts with nothing typed.
- **AC9 – Change a card's command:** Given running shell card `sh`, when the user picks `Startup command…` from its menu, chooses `Claude Code` and saves, then `sh` shows the tag `Claude` and its shell keeps running with nothing typed; after `exit` and reopening, `claude --session-id <U>` runs. When the user then switches `sh` to `Shell`, stops and reopens it, then switches back to `Claude Code`, stops and reopens it, `claude --resume <U> || claude --session-id <U>` runs with the same `<U>`. Cancel in the dialog changes nothing.
- **AC10 – Retry after couldn't start:** Given `alpha` whose directory was removed after the workspace was created, when the user creates card `x`, then its status reads `Couldn't start: working directory not found`; when the user recreates `/tmp/drovr-alpha`, goes back and opens `x`, then `x` reads `Running` and `pwd` prints `/tmp/drovr-alpha`.
- **AC11 – Deletes:** Given Stopped card `agent` and running card `sh` in `alpha`, then deleting `agent` asks nothing, and deleting `alpha` says `1 terminal is still running and will be stopped.`
- **AC12 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass, with #4's smoke tests updated for D6 (Stopped instead of Exited, no read-only exited view).

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Startup commands in the model (core):** the startup command type (Shell / Claude Code / Custom with its command) and its validation (`Command is required`); cards gain startup command, agent session id (injected UUID generator, `crypto.randomUUID` in the app) and `claudeStarted`; workspaces gain a default startup command (`Shell`); create card takes a startup command (defaulting to the workspace's); store operations to set a card's startup command and to mark Claude started; workspace create/update take the default without touching cards. A pure function gives the line to type for a card's start (none for Shell; D5 for Claude Code; the command for Custom). Vitest unit tests. Add `Startup command`, `Agent session id` and `Stopped` to `CONTEXT.md`. Satisfies D2, D4, D5, D10 (logic), AC7 (validation).
2. **S2 – Stopped and start on open:** the card terminal registry gets the Stopped state (status `Stopped`, screen disposed on exit) and a start that works for a card that isn't running (new screen, spawn, retry after couldn't start); after a successful spawn it writes the start line (S1) and marks Claude started. Opening a card that isn't running starts it; the open view goes back to the board when its shell exits; creation uses the same path. Delete and workspace-delete counts treat Stopped as not running. Unit tests on the registry with fakes; update #4's smoke tests for D6; new smoke tests for Shell restart and retry. Satisfies AC3 (shell part), AC6, AC10, AC11.
3. **S3 – Choosing and changing the command:** the select and `Command` field in `+ New card`, the `Startup command` field in the workspace dialogs, the card menu's `Startup command…` dialog, the `Claude` / `Custom` tags. Smoke tests in a new e2e spec with the fake `claude`; update `AGENTS.md`'s smoke test list. Satisfies AC1, AC2, AC3, AC4, AC5, AC7, AC8, AC9, AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | `+ New card`, read the select, create, check the buffer has only the prompt, no tag |
| AC2 | unit (start line) + e2e | Create with `Claude Code`; read the buffer and `/tmp/drovr-claude.log`; check the UUID format and tag |
| AC3 | unit (registry) + e2e | Enter, `exit`; board visible, status `Stopped` |
| AC4 | unit (start line, registry) + e2e | Open again; buffer has no earlier output; log last line |
| AC5 | e2e | Same with `FAKE_CLAUDE_RESUME_FAILS=1`; log last two lines |
| AC6 | e2e | `exit 3`, status, reopen, `pwd` |
| AC7 | unit (validation) + e2e | Custom create, tag tooltip, reopen output; empty command error |
| AC8 | unit (store) + e2e | Workspace dialog field; edit default; preset and existing card |
| AC9 | unit (store, start line) + e2e | Card menu dialog, tag, restart, switch away and back |
| AC10 | unit (registry) + e2e | Remove dir, create, recreate dir, reopen |
| AC11 | unit + e2e | Delete stopped card; workspace delete dialog text |
| AC12 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The e2e tests launch Electron with `SHELL=/bin/bash` and `HOME` set to a temp directory whose `.bash_profile` puts the fake `claude` first on `PATH`, so the login shell finds it (system profiles may reset `PATH`). The developer checks the real Claude Code on macOS: create a Claude Code card, send a message, quit Claude and `exit`, reopen the card, and see the same conversation.

## Stack changes

None.

## Data and migrations

In the in-memory workspace model: cards gain `startup` (`{ kind: 'shell' } | { kind: 'claude' } | { kind: 'custom'; command: string }`), `agentSessionId` (UUID) and `claudeStarted` (boolean); workspaces gain `defaultStartup` (same type, `shell` for a new workspace). These are what the persistence item stores. No persistence yet, so nothing to migrate.

## Out of scope

- Cards surviving quit, reload or a Mac restart (the persistence item; it reuses D7).
- Stopping or restarting a running card from the UI.
- Keeping scrollback or shell state across a restart.
- Detecting agents other than Claude Code, or resuming them without a user-written command.
- Multi-line custom commands, per-card working directories, environment variables per card.

## Open questions

- **Deferred:** presets for other agents (e.g. Codex) so Drovr resumes them without the user writing a command (round 2 Q6). Their CLIs can't start a session with an id Drovr chooses, so this needs per-agent research; a follow-up idea on the board.
