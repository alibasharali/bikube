---
item: 1
type: feature
title: "PoC: terminal in Electron"
status: draft
branch: claude/1-start-drovr
---

# PoC: terminal in Electron

## Problem

Drovr is a kanban board where every card is a live terminal. Its whole premise rests on one part: an xterm.js + node-pty terminal inside Electron that resizes correctly, renders colours, supports copy and paste, and stays fast with many terminals open. The repo holds only the factory kit. After this ships the project is scaffolded, CI and a release workflow that builds an unsigned macOS .dmg exist, a spike proves the terminal layer, and everything else in the description is an idea on the board.

## Domain decisions

- **D1 – Stack:** Electron + TypeScript, electron-vite (Vite) for build, React for the renderer, xterm.js (with fit and WebGL addons), node-pty, Vitest, npm, electron-builder for the .dmg. *Why:* the developer approved this in round 1 (Q1) over vanilla-TS and Tauri alternatives; it is the combination VS Code's terminal uses.
- **D2 – Stack is described in words:** the registry has no desktop option, so `.factory/stack.json` carries it under `described`; hosting, database and auth stay none (local app). *Why:* nothing in the registry fits; the last slice proposes it to the registry.
- **D3 – First step:** the terminal spike plus scaffold, CI and the release workflow. No board, no persistence. *Why:* developer choice (Q2); the terminal layer is the part that could sink the project.
- **D4 – Persistence deferred:** the spike stores nothing; SQLite vs JSON file is decided in its own item. *Why:* developer choice (Q3).
- **D5 – Testability on Linux:** PTY/session logic lives in plain TS modules with no Electron imports (`src/core/...`), tested with Vitest on Linux. Electron-side behaviour gets a smoke test run headless under xvfb in CI. macOS-only checks (the .dmg, copy/paste feel) are the developer's on the beta. *Why:* developer choice (Q4); cloud sessions are Linux.
- **D6 – Process boundary:** node-pty runs in the Electron main process behind a small session manager; the renderer talks to it through a typed preload IPC bridge (contextIsolation on, nodeIntegration off). *Why:* the standard secure Electron layout, and it keeps the session manager unit-testable.
- **D7 – Spike UI:** one window with a toolbar (a "New terminal" button and a count) and a grid of terminals; the shell is the user's login shell (`$SHELL`, falling back to `/bin/bash`) started in the user's home directory. It is throwaway UI to prove the layer; the board replaces it later. *Why:* the spike must show 10 terminals at once, which a single-terminal view cannot.
- **D8 – Performance budget:** with 10 terminals open, a benchmark that streams output to all of them keeps the main process responsive; the budget is no dropped input echo beyond 100 ms and the renderer at or above 30 fps while 10 sessions each print continuously. WebGL renderer where available, canvas/DOM fallback otherwise. *Why:* "acceptable performance" needs a number; the developer can revise it after trying the beta.
- **D9 – Release:** publishing a GitHub release runs a workflow on a `macos-latest` runner that builds an unsigned .dmg with electron-builder and attaches it to that release; a pre-release is a beta. Signing and notarization are out until the developer has an Apple Developer account. *Why:* the Releases delivery preset and the developer's description.
- **D10 – Portability:** no choice rules out Linux or Windows builds later (no macOS-only APIs outside packaging and window chrome). *Why:* the description asks for this.

## Acceptance criteria

- **AC1 – Check is real:** Given a clean checkout, when `.claude/check.sh` runs, then it runs install, typecheck, lint, Vitest and the build plus `node .factory/check-stack.mjs`, and exits 0.
- **AC2 – CI:** Given a pull request, when CI runs, then a job named `check` runs `.claude/check.sh` and, in addition, the xvfb Electron smoke test, and passes.
- **AC3 – App starts:** Given the built app, when it launches (under xvfb in CI), then a window opens with one terminal running the login shell and the toolbar showing "1 terminal".
- **AC4 – Terminal works:** Given an open terminal, when `echo hello` is typed and Enter pressed, then `hello` appears in the terminal output (smoke test reads the buffer).
- **AC5 – Resize:** Given a terminal, when its container is resized from 800x400 to 400x200 px, then xterm's cols/rows change to match and the PTY reports the same size (`stty size` prints the new rows and cols).
- **AC6 – Colours:** Given a terminal, when the 16 ANSI colours, a 256-colour and a truecolor escape sequence are printed, then xterm's buffer cells carry the matching colour attributes, and a screenshot is attached for the developer's eyes.
- **AC7 – Copy and paste:** Given selected terminal text, when the copy shortcut is used, then the clipboard holds that text exactly; given clipboard text containing a newline, when pasted, then it reaches the shell (bracketed paste when the shell enables it). Unit-tested at the clipboard/IPC seam; the feel on macOS is the developer's check on the beta.
- **AC8 – Ten terminals:** Given the spike window, when "New terminal" is pressed until 10 terminals are open and each runs a continuous-output command, then all 10 stay live and the D8 budget holds, and the measured numbers are posted in the PR.
- **AC9 – Session lifecycle:** Given a session manager with running sessions, when a shell exits or a session is killed, then its exit is reported with the exit code, and no PTY processes are left after app quit (unit-tested with real PTYs on Linux).
- **AC10 – Release workflow:** Given the workflow file, when a release is published, then a macOS job builds an unsigned .dmg and attaches it to the release; `actionlint` passes on it in `check`, and the developer confirms the first real run on the beta.
- **AC11 – Instructions and declaration:** Given the repo, then `.factory/stack.json` declares the stack, `docs/adr/0001-stack.md` records it, and `AGENTS.md` lists the real commands.
- **AC12 – Plan on the board:** Given the spec's Later section, then each line is an idea on the board.
- **AC13 – Registry:** Given the finished item, then `propose_stack_change` returned a pull request for the Electron option, or the ledger says why not.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Scaffold and prove the stack:** generate the project with electron-vite's official React + TypeScript template, add Vitest, ESLint, typecheck, electron-builder config; write `.factory/stack.json` (via `render_stack_files`), `.claude/check.sh`, the `check` CI job with setup steps, `docs/adr/0001-stack.md` and the commands in `AGENTS.md`. Window opens with an empty page under xvfb. Satisfies AC1, AC2 (check part), AC11.
2. **S2 – Put the plan on the board:** `create_item(..., "idea", 1)` for each line of Later, numbers recorded in the ledger. Satisfies AC12.
3. **S3 – One terminal end to end:** session manager (node-pty, plain TS) with spawn, write, resize, kill, exit events; IPC bridge; xterm.js view with fit addon; login shell in home dir; xvfb smoke test. Satisfies AC3, AC4, AC5, AC9.
4. **S4 – Colours, copy and paste:** WebGL addon with fallback, clipboard handling and paste through the bridge. Satisfies AC6, AC7.
5. **S5 – Ten terminals and performance:** the grid and "New terminal" toolbar, a benchmark script that drives 10 sessions, results posted in the PR. Satisfies AC8.
6. **S6 – Release workflow:** the macOS release workflow building the unsigned .dmg, validated with actionlint; an `npm run dist` smoke on Linux for the packaging config where possible. Satisfies AC10.
7. **S7 – Contribute to the stack registry:** `propose_stack_change` with a `desktop` Electron option (`experimental`) and guidelines from the ledger; link in the PR. Satisfies AC13.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | `.claude/check.sh` | run it, expect exit 0 |
| AC2 | CI `check` job | PR checks green |
| AC3 | Playwright-Electron smoke under xvfb | launch, assert window title and "1 terminal" |
| AC4 | Smoke test types into xterm, reads buffer | assert `hello` in buffer |
| AC5 | Smoke test sets container size; unit test on session manager resize | `stty size` output matches |
| AC6 | Smoke test prints escapes, inspects buffer cell attributes; screenshot | cells carry expected colours |
| AC7 | Unit test of clipboard/paste handler; smoke test | clipboard equals selection; pasted text reaches shell |
| AC8 | Benchmark script under xvfb | 10 sessions streaming, numbers vs D8 |
| AC9 | Vitest with real PTYs | exit codes reported, no leftover processes |
| AC10 | actionlint in `check`; real run on the beta | release attaches the .dmg |
| AC11 | `check-stack.mjs`, file review | files present and consistent |
| AC12 | Board | ideas exist in Backlog |
| AC13 | `propose_stack_change` result | PR link |

## Stack changes

Brings in, described in words (not in the registry): Electron, TypeScript, electron-vite, React, xterm.js (+ fit, webgl addons), node-pty, Vitest, ESLint, electron-builder, npm. S1 writes `.factory/stack.json` and the files `render_stack_files` returns. No hosting, database or auth.

## Data and migrations

None. The spike stores nothing.

## Out of scope

- Everything under Later below (the board, workspaces, persistence, CLI, ...).
- Signing and notarization of the .dmg.
- Linux and Windows builds (not ruled out by D10).

## Later (become ideas in S2)

1. **Workspaces:** create workspaces (one per repo) with a name and a working directory every terminal starts in.
2. **Board columns:** per-workspace columns the user can add, rename, reorder and delete, with defaults Backlog, Running, Needs me, Done.
3. **Cards as terminals:** create cards (a titled terminal session via the login shell); open one full size; show title and a one-line status (running, exited, last output line) on the board.
4. **Resume and startup command:** a per-card startup command run when the terminal is not open (e.g. `claude --resume <id>`); restart exited cards in the same directory.
5. **Drag and drop:** move and reorder cards between columns without stopping their processes.
6. **Close card:** ask before killing a running process; closed cards can be resumed later.
7. **Persistence:** workspaces, columns, cards, positions, directories and titles survive restarts (SQLite vs JSON decided in that item).
8. **`board` CLI:** a local command (`board move`, `board status`) talking to the app over a user-only local socket so agents can move their own card and set status.
9. **Themes and settings:** beyond the basics.
10. **Split panes inside a card.**
11. **SSH / remote workspaces.**
12. **Sync between machines.**
13. **Linux and Windows builds.**
14. **Code signing and notarization:** once an Apple Developer account exists.

## Open questions

- deferred: SQLite vs JSON for persistence (decided in the persistence item).
- deferred: the D8 performance budget numbers may be revised after the developer tries the beta.
