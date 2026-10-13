---
item: 4
type: feature
title: Cards as terminals
status: draft
branch: claude/4-cards-as-terminals
---

# Cards as terminals

## Problem

The board from #2 has workspaces and columns but nothing in them: the terminal code from the spike sits unused. A developer running several agents in a repo needs each one as a card on that repo's board. After this ships they can create a card in any column, which starts their login shell in the workspace's working directory, use it at full size, go back to the board, and see each card's title and a one-line status (running or exited, and its last output line), with the process kept alive the whole time.

## Domain decisions

- **D1 – Card:** a card belongs to one workspace and one column and has an id, a title and a working directory. Cards sit in their column in creation order (new cards at the bottom); reordering and moving between columns come with drag and drop (later item). Cards live in the in-memory workspace store next to the columns, so they are lost on quit like the rest of the board (#2 D4). *Why:* item description; persistence is its own item.
- **D2 – Working directory:** a card stores its own directory at creation, copied from its workspace's directory then. Later edits to the workspace's directory don't move existing cards; new cards use the new directory. *Why:* a running process can't change directory; the card has to record where it really runs.
- **D3 – Process:** creating a card starts the user's login shell (`$SHELL -l`, fallback `/bin/bash`, as the existing session manager does) in the card's directory, immediately. One card, one session, for the card's whole life: no restart in this item. Main checks the directory before spawning (absolute path, existing directory); when the check or the spawn fails, the card still exists and its status reads `Couldn't start: <reason>` (e.g. `Couldn't start: working directory not found`). *Why:* Q3, Q6; a directory can disappear between workspace creation and card creation.
- **D4 – Creation:** every column ends with a `+ New card` button. It turns into an inline title input; Enter creates the card at the bottom of that column, Esc or blur with nothing typed cancels. *Why:* Q1.
- **D5 – Title:** trimmed. Empty at creation means `Terminal N`, where N starts at 1 per workspace and goes up by one each time a card gets a default title (never reused, even after deletes). Duplicates are allowed. Renaming to an empty or whitespace title is rejected inline (`Title is required`). Titles are shown on one line, truncated with an ellipsis; the full title is in the tooltip. *Why:* Q2.
- **D6 – Open on create:** creating a card opens it at full size with the terminal focused. *Why:* Q3, the developer's choice over staying on the board.
- **D7 – Full-size view:** clicking a card (or Enter on a focused card) opens it. The view replaces the board area; the sidebar stays. Its header shows the card's title, its status (D9) and a `Back` button; the rest is the terminal, fitted to the area and resized with the window. Only one card is open at a time. *Why:* Q4.
- **D8 – Leaving full size:** the `Back` button, or Cmd+Shift+B on macOS (Ctrl+Shift+B elsewhere), even while the terminal has focus; the shortcut is not sent to the shell. Esc and every other key go to the terminal. Selecting another workspace in the sidebar also leaves the view and shows that workspace's board. Leaving never stops the process. *Why:* Q5; vim and Claude Code use Esc.
- **D9 – Status:** each card shows a one-line status on the board and in the full-size header:
  - running: `Running`, then the last output line;
  - exited: `Exited (code N)` (or `Exited (signal N)` when a signal ended it), then the last output line;
  - failed to start: `Couldn't start: <reason>` (D3).
  The last output line is the last non-blank line of the terminal screen at or above the cursor, with escape sequences removed and whitespace trimmed; it is often the shell prompt. Empty when there is none. The board updates it while the process prints, at most about 4 times a second per card. *Why:* item description; Q6. The rule for "last line" is a technical decision.
- **D10 – Terminals outlive views:** a card's terminal (its screen and scrollback) lives as long as the card, not as long as a view: closing the full-size view, switching workspaces or opening another card keeps it and its process running, and reopening shows the same screen. Output keeps streaming into cards that aren't open. *Why:* that is the product; the spike's terminal view killed its process on unmount.
- **D11 – Exit:** when the process exits the card stays, with the exited status (D9). Opening it shows the final output, read-only (typing does nothing). No restart in this item. *Why:* Q6.
- **D12 – Card menu:** each card on the board has a menu with `Rename` and `Delete`. Rename edits the title inline on the card (Enter saves, Esc cancels; D5 rules); double-clicking the title does the same. *Why:* Q7.
- **D13 – Delete card:** when the card's process is running, Delete asks for confirmation: `Delete "<title>"? Its terminal is still running and will be stopped.` with `Delete` and `Cancel`; confirming kills the process and removes the card. An exited or failed card is deleted without confirmation. *Why:* Q7.
- **D14 – Delete column:** a column that has cards can't be deleted: the menu's Delete is disabled with the hint `Delete its cards first`. The existing rules stand (an empty column deletes without confirmation; the last column can't be deleted). *Why:* Q8; moving cards comes with drag and drop.
- **D15 – Delete workspace:** the existing confirmation adds, when any of its cards' processes are running, `N terminals are still running and will be stopped.` (`1 terminal is` for one). Confirming kills every one of its cards' processes and removes the workspace. Without running cards the dialog is unchanged. *Why:* Q9.
- **D16 – Window lifecycle unchanged:** quitting, closing, reloading or crashing the window still kills every process the window started (#4, lifecycle fix). With no persistence the cards are gone on next launch. *Why:* existing behaviour; persistence and resume are later items.
- **D17 – Smoke tests and benchmark (chore #19):** this item adds terminal smoke tests for cards and points the 10-terminal benchmark at 10 cards in one workspace, all streaming, one open at full size; the budget (≥ 30 fps, echo ≤ 100 ms p95, main-process lag ≤ 100 ms) is unchanged. `AGENTS.md` stops calling the benchmark broken. *Why:* Q10, the developer's choice to fold #19 in.
- **D18 – Security boundaries unchanged:** contextIsolation on, nodeIntegration off, sandbox on. `terminal:spawn` gains a working-directory argument, checked in main (string, absolute, existing directory) before spawning, with unit-tested guards in the `ipc-guards` style. *Why:* AGENTS.md.

## Acceptance criteria

Workspace `alpha` has working directory `/tmp/drovr-alpha` (an existing directory) and the default columns, unless stated otherwise.

- **AC1 – Create with title:** Given `alpha`'s board, when the user clicks `+ New card` under `Backlog`, types `api server` and presses Enter, then the full-size view opens with header `api server` and status starting `Running`, the terminal has focus, and running `pwd` in it prints `/tmp/drovr-alpha`.
- **AC2 – Default titles:** Given `alpha` with no cards, when the user creates three cards with an empty title, deletes `Terminal 2`, and creates another with an empty title, then the cards read `Terminal 1`, `Terminal 3`, `Terminal 4`; a card titled `api` twice in the same column is allowed.
- **AC3 – Back and board:** Given card `api` open at full size, when the user presses `Back` (or Cmd/Ctrl+Shift+B while the terminal has focus), then the board shows `api` at the bottom of `Backlog`, `Backlog`'s count reads `1`, and the shell is still running (status `Running`). Pressing Esc in the full-size view sends Esc to the terminal and does not leave the view.
- **AC4 – Status line:** Given card `api` on the board, when the user opened it and ran `printf 'drovr-marker'; sleep 30`, then went back, then within 1 second the card's status reads `Running` and `drovr-marker`.
- **AC5 – Kept alive:** Given card `api` where the user ran `export DROVR_X=42`, when the user goes back to the board, switches to workspace `beta` and back to `alpha`, and opens `api` again, then the earlier output is still on screen and `echo $DROVR_X` prints `42`.
- **AC6 – Exit:** Given card `api` open, when the user types `exit 3`, then the status reads `Exited (code 3)`; back on the board the card still shows with that status; reopening shows the final output and typing does nothing.
- **AC7 – Couldn't start:** Given `alpha` whose directory was removed from disk after the workspace was created, when the user creates card `x`, then the card exists with status `Couldn't start: working directory not found` and no process is started.
- **AC8 – Directory per card:** Given card `one` created in `alpha`, when the user changes `alpha`'s directory to `/tmp/drovr-other` and creates card `two`, then `pwd` prints `/tmp/drovr-alpha` in `one` and `/tmp/drovr-other` in `two`.
- **AC9 – Rename:** Given card `api`, when the user picks `Rename` from its menu, types `api v2` and presses Enter, then the card and its full-size header read `api v2`; renaming to blank shows `Title is required` and keeps `api v2`; Esc cancels.
- **AC10 – Delete card:** Given running card `api`, when the user picks `Delete`, then the confirmation names `api`; Cancel keeps it running; Delete removes it and its process is stopped. Given exited card `old`, Delete removes it with no confirmation.
- **AC11 – Delete column with cards:** Given `Backlog` holds a card, then its column menu's Delete is disabled with hint `Delete its cards first`; after the card is deleted, Delete works again.
- **AC12 – Delete workspace with cards:** Given `alpha` with two running cards and one exited card, when the user deletes `alpha`, then the confirmation says `2 terminals are still running and will be stopped.`; Cancel changes nothing; confirming removes `alpha` and stops both processes.
- **AC13 – Checks, smoke and benchmark:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass, and `xvfb-run -a npm run benchmark` creates 10 cards in one workspace, streams in all of them with one open, and writes `test-results/benchmark-sustained.md` with the budget in D17 met.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Cards in the workspace model (core):** cards in the workspace store: create (title rules, default `Terminal N` counter per workspace, directory copied from the workspace), rename, delete, cards per column, column delete refused while it has cards, workspace directory edits leave cards alone. Plus a pure status module: last output line from screen lines and cursor row, ANSI stripped, and the status label for running, exited (code or signal) and couldn't-start. Vitest unit tests. Satisfies AC2, AC8, AC9, AC11 (logic), D9 (rule).
2. **S2 – Spawn in a directory:** `terminal:spawn` takes the working directory; main checks it (guards in `ipc-guards`, directory check via the existing core helper) and rejects with a reason the renderer can show; the session manager starts the shell there. Unit tests for the guards and the rejection. Satisfies AC7 (main side), D18.
3. **S3 – Card terminals, creation and full-size view:** a renderer-side registry keeps one terminal (xterm instance, session, status) per card for the card's life and attaches its screen to the full-size view when opened; `+ New card` inline creation per column; open on create; full-size view with header, status and Back; the Cmd/Ctrl+Shift+B shortcut; cards on the board with title and throttled status; exit and couldn't-start handling; column counts. Smoke tests for these in a new e2e spec. Satisfies AC1, AC3, AC4, AC5, AC6, AC7, AC8.
4. **S4 – Card menu, deletes and confirmations:** card menu with Rename and Delete, inline rename, delete confirmation when running (kills the process), column Delete disabled with hint, workspace delete confirmation with the running count and killing its cards' processes. Smoke tests. Satisfies AC9, AC10, AC11, AC12.
5. **S5 – Benchmark on cards:** point `e2e/benchmark.spec.ts` at 10 cards in one workspace (D17), update `AGENTS.md` (benchmark works again, smoke test list). Satisfies AC13.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e smoke | Create workspace on a temp dir, `+ New card`, title, Enter; assert header and `pwd` output in the xterm buffer |
| AC2 | unit (store) + e2e | Create/delete sequence, read card titles |
| AC3 | e2e | Back button and shortcut; card in column, count `1`, status `Running`; Esc stays in view |
| AC4 | unit (status module) + e2e | Run the printf command, go back, poll the card's status text |
| AC5 | e2e | Workspace switch and reopen; buffer still has earlier output; `echo $DROVR_X` |
| AC6 | e2e | `exit 3`, read status on view and board |
| AC7 | unit (guards) + e2e | Remove the temp dir after workspace creation, create a card, read status |
| AC8 | unit (store) + e2e | Change workspace directory, `pwd` in both cards |
| AC9 | unit + e2e | Rename via menu, blank rename, Esc |
| AC10 | e2e | Delete with confirm/cancel; process gone (session no longer echoes; exit seen) |
| AC11 | unit + e2e | Column menu Delete disabled while a card is in it |
| AC12 | e2e | Workspace delete dialog text, cancel, confirm |
| AC13 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke`, `xvfb-run -a npm run benchmark` | Read `test-results/benchmark-sustained.md` |

The native folder picker and the macOS Cmd shortcut can't be driven on Linux; e2e uses typed paths and Ctrl+Shift+B, and the developer checks Cmd+Shift+B on macOS.

## Stack changes

None.

## Data and migrations

The in-memory workspace model gains cards (id, title, column id, working directory) and a per-workspace counter for default titles. Session ids and statuses are runtime state in the renderer, not part of the model. No persistence, so nothing to migrate.

## Out of scope

- Drag and drop and reordering cards; moving cards between columns.
- Restarting an exited card, startup/resume commands, an agent CLI that moves cards or sets status.
- Persistence of cards; processes surviving an app restart.
- Per-card working directory chosen at creation (cards always use the workspace's directory).
- Closing a card while keeping it resumable (the v1 "close" behaviour comes with resume).

## Open questions

None. Backlog chore #19 is folded into this item (D17); close it once this ships.
