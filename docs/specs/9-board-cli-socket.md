---
item: 9
type: feature
title: board CLI over a local socket
status: approved
branch: claude/9-board-cli-socket
---

# board CLI over a local socket

## Problem

A coding agent running inside a card can't tell the board what it is doing: the developer has to drag its card to `Needs me` or `Done` and read its terminal to learn its state. The product's last v1 point asks for a small command, `board`, that a program inside a card calls to move a card or set its status line, talking to the running app over a local socket that only the same user can reach. After this ships, `board move . "Needs me"` and `board status . "running tests"` typed (or run by an agent) in any card change the board at once, and nothing outside the user's account can do the same.

## Domain decisions

- **D1 – Commands:** `board move <card> <column>` and `board status <card> <text>`. `board`, `board help`, `board --help` print usage to stdout and exit 0; any other shape (unknown command, missing or extra arguments) prints usage to stderr and exits 2. *Why:* product description; round 1 Q6.
- **D2 – Card reference:** `<card>` is `.` for the calling card, or a card's id, or a card's title (exact, case-sensitive) among the cards of the calling card's workspace. An id wins over a title. A title matching two or more cards is an error naming the count (`board: 2 cards are titled "api"; use the card id`). A card in another workspace is never reachable. *Why:* round 1 Q1: self-moves are the common case; an orchestrating agent may move its siblings, never another repo's board.
- **D3 – The calling card:** every shell Drovr starts gets `DROVR_CARD_ID` (the card's id), `DROVR_SOCKET` (the socket's absolute path) and Drovr's bin directory prepended to `PATH`, so `board` resolves inside every card and every program the card starts. The renderer passes the card id with each spawn request; main checks it is a non-empty string of at most 100 chars and records which session runs which card. A request is served only when its `DROVR_CARD_ID` names a card with a live session in this app run; otherwise `board: not running inside a Drovr card` (also when the variables are missing). *Why:* round 1 Q3; tying requests to a live session means a stale variable from a stopped card does nothing.
- **D4 – How `board` runs:** `board` is a POSIX `sh` script in Drovr's bin directory that runs Drovr's bundled CLI module with Drovr's own executable as Node (`ELECTRON_RUN_AS_NODE=1`, executable and module paths given by environment variables main sets alongside D3). No global install, no admin rights, no separate Node. In the packaged app the bin directory and the CLI module are real files outside the asar archive. *Why:* round 1 Q3; nothing to install, works in dev, tests and the packaged app, no new dependency.
- **D5 – Socket:** main listens on a Unix domain socket `board.sock` in the `userData` directory (so `DROVR_USER_DATA_DIR` gives each test its own, #8 D11). Before listening it removes a leftover `board.sock`; it creates the socket with umask so the file is mode `0600` from the start, and removes it on quit. If listening fails (path too long, I/O error), the app runs without the socket and logs it; `board` then reports D9's "app not reachable". The one-instance lock (#8 D12) means one listener per data directory. Windows (named pipe) is left for the Windows build. *Why:* round 1 Q4: file permissions are the user boundary; a TCP port would be reachable by every local user.
- **D6 – Protocol:** one connection per command; the CLI sends one line of JSON `{"v":1,"cardId":…,"command":"move","card":…,"column":…}` or `{"v":1,"cardId":…,"command":"status","card":…,"text":…}` and main answers one line `{"ok":true}` or `{"ok":false,"error":"<reason>"}`, then closes. Main rejects (with an error reply) anything else: invalid JSON, another `v`, missing or mistyped fields, a request line over 8 KB; a connection that sends no full line within 5 s is closed. *Why:* simple, testable with a plain socket, versioned for later commands.
- **D7 – Move:** `<column>` is a column title of the card's workspace, matched case-insensitively after trimming. The card goes to the bottom of that column, like a menu or keyboard move (#6), and its process keeps running (product). Moving a card to the column it is already in changes nothing and succeeds. No match: `board: no column "<column>"; columns are: Backlog, Running, Needs me, Done` (the workspace's columns in board order). The change is saved like any board change (#8 D6) and shows at once on the board and in the sidebar's workspace, active or not; a card open at full size stays open. *Why:* round 1 Q2.
- **D8 – Status text:** `board status <card> <text>` sets the card's **agent status**: the text with escape sequences and control characters removed (`stripEscapes`), whitespace collapsed to single spaces and trimmed, cut to 200 chars. While set and the card is `Running`, it replaces the last output line on the card's status line everywhere the status shows (`Running · <text>`). Empty text (after cleaning) clears it, and the last output line shows again. It is cleared when the card's process stops or fails, and when it starts again. Setting it on a card that isn't running fails: `board: "<title>" is not running`. It is runtime only, never saved (#8 D1). *Why:* round 1 Q5.
- **D9 – Results:** success prints nothing and exits 0. Any refusal exits 1 with `board: <reason>` on stderr: D2's card errors (`board: no card "<card>" in this workspace`), D3, D7, D8, `board: Drovr is not running` when the socket can't be connected to, `board: Drovr has no open window` when the window that owns the calling card's session is gone, and `board: no answer from Drovr` after 5 s. *Why:* round 1 Q6: agents can read the reason and recover.
- **D10 – Who applies requests:** main resolves nothing itself: it forwards a valid request to the window whose page owns the calling card's session, over a new main→renderer IPC message, and relays that window's answer. The renderer resolves card and column against its store, applies the move or status, and answers. Resolution and validation are plain core functions. The renderer's answer channel accepts only a window's own top-level frame, and main only accepts an answer for a request it sent to that window. *Why:* the renderer owns the model (#2 D4); AGENTS.md window security stays as is.

## Acceptance criteria

Workspace `alpha` (`/tmp/drovr-alpha`) has the default columns `Backlog, Running, Needs me, Done`; card `api` is in `Backlog` and running a shell unless stated otherwise. Commands are typed into `api`'s terminal at full size.

- **AC1 – Self-move:** Given `api` in `Backlog`, when the user runs `board move . done`, then the command exits 0 printing nothing, `api` is at the bottom of `Done` after `Back`, its status still reads `Running`, and after a restart (#8) `api` is in `Done`.
- **AC2 – Move a sibling:** Given cards `api` and `web` in `Backlog`, when `api` runs `board move web "Needs me"`, then `web` is in `Needs me` and `api` stays in `Backlog`. Running `board move <web's id> Running` moves `web` to `Running`.
- **AC3 – Move errors:** Given `api`, when it runs `board move . Review`, then it exits 1 with stderr `board: no column "Review"; columns are: Backlog, Running, Needs me, Done`; `board move ghost Done` exits 1 with `board: no card "ghost" in this workspace`; with two cards titled `dup`, `board move dup Done` exits 1 with `board: 2 cards are titled "dup"; use the card id`; nothing moved.
- **AC4 – Other workspaces unreachable:** Given workspace `beta` with card `other`, when `api` (in `alpha`) runs `board move other Done`, then it exits 1 with `board: no card "other" in this workspace` and `other` hasn't moved.
- **AC5 – Status:** Given `api` running, when it runs `board status . "running tests"`, then `api`'s status line reads `Running · running tests` on the board and in the full-size view, even after more output; `board status . ""` restores the last output line; text `a\x1b[31mb` shows as `ab`, and a 300-char text shows its first 200 chars.
- **AC6 – Status cleared on stop:** Given `api` with status `running tests`, when `exit` is typed so `api` is `Stopped`, then its status line reads `Stopped` with no text, and opening it again shows `Running` with the last output line, not `running tests`. Given `old` Stopped, `board status old hi` from `api` exits 1 with `board: "old" is not running`.
- **AC7 – Usage:** `board` prints usage and exits 0; `board move .` and `board frob` print usage to stderr and exit 2.
- **AC8 – Outside a card:** Given the app running, when `board move . Done` runs with no `DROVR_CARD_ID`, or with the id of a Stopped or deleted card, then it exits 1 with `board: not running inside a Drovr card`; with `DROVR_SOCKET` pointing at no listener it exits 1 with `board: Drovr is not running`.
- **AC9 – User-only socket:** Given the app running, `<userData>/board.sock` exists with mode `0600` (`srw-------`), is replaced if a stale one exists at launch, and is gone after the app quits.
- **AC10 – Bad requests:** Writing `hello\n`, `{"v":2}\n` or a 9 KB line to the socket gets `{"ok":false,…}` and the connection closes; the board is unchanged and the app keeps serving `board`.
- **AC11 – Packaged:** in the unpacked app from `npm run pack` on Linux, the bin directory's `board` is a real executable file outside the asar archive and `board move . Done` from a card works.
- **AC12 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Command core:** plain-TS modules for: CLI argument parsing to a request or usage error (D1); the request line parser and validator (D6); card and column resolution in a workspace with the exact error texts (D2, D7); agent status text cleaning (D8). Vitest for every case named in D1, D2, D6, D7, D8, AC3, AC7. Satisfies parts of AC3, AC5, AC7, AC10.
2. **S2 – Socket, CLI and move end to end:** the spawn request carries the card id and main records session→card; the spawned shell gets D3's variables; main's socket server (core server with an injected handler, tested with a real socket in a temp dir) with D5's lifecycle and D6's limits; forwarding to the owning window and the renderer applying moves (D10); the `board` wrapper and CLI entry built into the app (D4), with electron-builder keeping them outside the asar; `AGENTS.md` and `CONTEXT.md` (**board command**, **agent status**) updated. New `e2e/board-cli.spec.ts` covers AC1–AC4, AC7–AC10. Satisfies AC1–AC4, AC7–AC10.
3. **S3 – Agent status:** the renderer keeps each card's agent status, shows it in place of the last output line while running, clears it on stop/fail/start (D8); `CardStatusLine` and status rules in core updated. Vitest for the status rules; e2e AC5, AC6. Satisfies AC5, AC6.
4. **S4 – Packaged check:** confirm AC11 with `npm run pack` and fix packaging if needed; README/AGENTS mention `board`. Satisfies AC11, AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (S1) + e2e | Type `board move . done` in `api`; Back; read columns; restart; read columns |
| AC2 | e2e | Run the two moves from `api`; read `web`'s column |
| AC3 | unit (S1) + e2e | Run each command; read terminal output and exit code (`echo $?`) |
| AC4 | e2e | Create `beta`/`other`; run from `api`; read output and `beta`'s board |
| AC5 | unit (S1, S3) + e2e | Run status commands; read the card's status line on the board and full-size |
| AC6 | unit (S3) + e2e | `exit`; read status; reopen; run status on a Stopped card |
| AC7 | unit (S1) + e2e | Run `board`, `board move .`, `board frob`; read output and `$?` |
| AC8 | e2e | `env -u DROVR_CARD_ID board move . Done`; `DROVR_CARD_ID=<stopped id> board …`; `DROVR_SOCKET=/tmp/none.sock board …` |
| AC9 | unit (server) + e2e | `ls -l` the socket; stale file before launch; check absence after quit |
| AC10 | unit (S1, server) + e2e | `node -e` client writing bad lines; then a normal `board` command works |
| AC11 | manual in session | `npm run pack`; launch the unpacked app; inspect `resources`; run `board` in a card |
| AC12 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS that `board move . Done` works from a card in the packaged .dmg app, including inside a running Claude Code session.

## Stack changes

None: Node's `net` module and an `sh` script; no new dependency, database or service.

## Data and migrations

None. The saved state (#8) is unchanged; agent status is runtime only. A new runtime file `<userData>/board.sock` exists while the app runs.

## Out of scope

- Other commands (listing cards or columns, creating or deleting cards, renaming, choosing a position within a column).
- Reaching cards in other workspaces; calling `board` from outside a card.
- Windows named pipe and a `board.cmd`; installing `board` on the user's global PATH.
- Saving agent status across restarts; notifications when an agent moves a card.

## Open questions

None.
