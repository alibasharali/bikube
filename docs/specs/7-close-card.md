---
item: 7
type: feature
title: Close card
status: approved
branch: claude/7-close-card
---

# Close card

## Problem

Since #5 a card whose shell has exited is `Stopped` and resumes with its startup command the next time it is opened, but the only way to get there is to quit the program and type `exit`; the UI can only delete a running card, which loses it. A developer done with an agent for now wants to put the card down and pick it up later. After this ships they can close a running card from its menu or from the full-size view: Drovr asks first, stops its process, and the card stays where it is as `Stopped`, ready to resume when opened (#5 D7).

## Domain decisions

- **D1 – Close:** closing a card stops its process and nothing else: the card keeps its column, position, title, startup command, agent session id and `claudeStarted`, and becomes `Stopped` (#5 D6) once its shell has exited. Opening it again starts it with its startup command (#5 D7), so a Claude Code card resumes its conversation. It is not hidden, archived or moved. *Why:* round 1 Q1, Q5; Stopped and resume-on-open already exist, and columns are the user's call.
- **D2 – How it stops:** the card's shell session is killed through the existing `terminal:kill` channel (node-pty's default SIGHUP, as on delete); the card turns `Stopped` when main reports the exit, through the same path as a shell that exits by itself. Until then it stays `Running`. A card closed while its shell is still starting has the shell killed as soon as it arrives, without typing its startup command (so a first-start Claude Code card doesn't record `claudeStarted` for a conversation that never began). A Close dialog left open after the card stopped or failed to start by itself is dismissed. No escalation to a stronger signal. *Why:* reuses #5's exit handling; the login shell passes SIGHUP on to its jobs, as closing a terminal window does. *Superseded by #18 D1:* the shell gets SIGKILL if it hasn't exited 2 s after the hangup.
- **D3 – Where:** the card menu gets `Close`, between `Startup command…` and `Delete`. The full-size view's header gets a `Close` button next to `Back`. Both are shown only while the card is running; a Stopped card or one that couldn't start shows neither. *Why:* round 1 Q2, Q4.
- **D4 – Confirmation:** `Close` on a running card always asks first, in a dialog titled `Close card` with the message `Close "<title>"? Its terminal will be stopped. Open the card again to start it with its startup command.` and the buttons `Close` and `Cancel`. Cancel (or Esc) changes nothing. While the dialog is open over the full-size view, the Back shortcut does nothing (as for other dialogs). *Why:* round 1 Q3; product: "it asks before killing a running process".
- **D5 – After closing:** closed from the full-size view, the view goes back to the board when the card turns `Stopped` (#5 D6). Closed from the board, the card's status changes to `Stopped` in place. *Why:* existing Stopped behaviour.
- **D6 – Running-count and deletes:** a closed card is Stopped, so deleting it asks nothing and the workspace-delete confirmation doesn't count it (#5 D13). *Why:* it has no process.
- **D7 – Security boundaries unchanged:** no new IPC channel; `terminal:kill` keeps its ownership checks. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md.

## Acceptance criteria

Workspace `alpha` has working directory `/tmp/drovr-alpha` (an existing directory), the default columns and default startup command `Shell`, unless stated otherwise. The fake `claude` is the one from #5's smoke tests (logs its arguments to `/tmp/drovr-claude.log`, waits on stdin).

- **AC1 – Close from the menu:** Given running Shell card `api` in `Running` (second in that column) on the board, when the user picks `Close` from its menu, then a dialog titled `Close card` reads `Close "api"? Its terminal will be stopped. Open the card again to start it with its startup command.`; on `Close`, the shell process ends, `api` reads `Stopped`, and it is still the second card in `Running`.
- **AC2 – Cancel:** Given running card `api`, when the user picks `Close` and then `Cancel` (and again, presses Esc), then the dialog closes, `api` still reads `Running` and its shell process is alive.
- **AC3 – Close from the full-size view:** Given card `api` open at full size and running, when the user presses the header's `Close` and confirms, then the board is shown and `api` reads `Stopped`.
- **AC4 – Resume after closing:** Given Claude Code card `agent` running the fake claude, when the user closes it and opens it again, then `claude --resume <U> || claude --session-id <U>` runs with the same agent session id `<U>` and the log's last line is `--resume <U>`; a closed Shell card opened again runs a new shell where `pwd` prints `/tmp/drovr-alpha`.
- **AC5 – Not offered when not running:** Given Stopped card `old` and card `x` that couldn't start (directory removed), then neither card's menu has `Close`, and the full-size view of `x` has no `Close` button.
- **AC6 – Deletes after closing:** Given card `api` closed, then deleting it asks nothing, and with running card `sh` also in `alpha`, deleting `alpha` says `1 terminal is still running and will be stopped.`
- **AC7 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Close in the card registry (core):** the card registry gets a close/stop operation for a running card that kills its session and keeps the card's entry, which turns `Stopped` on the exit event (no-op for an unknown, Stopped or failed card); the close confirmation text sits with the other confirmation texts. Vitest unit tests with the fake terminal API: kill sent, state stays `running` until exit, then `stopped`; a later start gives a new screen and session. Satisfies D1, D2, D4 (text).
2. **S2 – Close in the UI:** `Close` in the card menu and the full-size header, shown only while running; the `Close card` confirmation dialog; closing goes through the S1 operation. Smoke tests in a new `e2e/close.spec.ts` (with the fake `claude` setup from `e2e/startup.spec.ts`, shared rather than copied where practical); `AGENTS.md`'s smoke test list mentions it. Add `Close` to `CONTEXT.md`. Satisfies AC1–AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (registry, text) + e2e | Card menu `Close`, read dialog, confirm; shell pid gone; status `Stopped`; card order in column |
| AC2 | e2e | Cancel and Esc; status `Running`; pid alive |
| AC3 | e2e | Header `Close`, confirm; board visible; status `Stopped` |
| AC4 | unit (registry) + e2e | Close and reopen Claude Code card with the fake claude; read the log; Shell card `pwd` |
| AC5 | e2e | Menu items of a Stopped and a couldn't-start card; header of the couldn't-start view |
| AC6 | e2e | Delete closed card, no dialog; workspace delete dialog text |
| AC7 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS that closing a real Claude Code card and reopening it returns to the same conversation.

## Stack changes

None.

## Data and migrations

None: closing changes only runtime state in the renderer's card registry. The workspace model is unchanged.

## Out of scope

- Hiding, archiving or listing closed cards; moving them on close.
- Detecting whether a program other than the shell runs before asking.
- Escalating to SIGKILL when a process ignores SIGHUP. (Done in #18 D1.)
- A keyboard shortcut for Close; closing several cards at once.
- Persistence across app restarts (its own item, reusing #5 D7).

## Open questions

None.
