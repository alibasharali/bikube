---
item: 8
type: feature
title: Persistence
status: approved
branch: claude/8-persistence
---

# Persistence

## Problem

Everything on the board lives in the renderer's memory (`InMemoryWorkspaceStore`), so quitting Drovr loses every workspace, column and card. A developer who sets up boards for several repos has to rebuild them after every restart, and Claude Code cards lose the agent session id that #5 uses to resume their conversation. After this ships, the board survives restarts: workspaces, columns, cards and their order, titles, directories and startup commands come back as they were, with every card `Stopped` until it is opened, which starts it again (Claude Code cards resume). ADR 0001 left the storage format to this item.

## Domain decisions

- **D1 – What persists:** the whole `WorkspaceState`: every workspace (id, name, directory, columns in order, cards in board order, `nextCardNumber`, `defaultStartup`) and `activeId`; every card's id, column, title, directory, startup command, agent session id and `claudeStarted`. Nothing about processes persists: sessions, screens, scrollback, run state and status lines are runtime only. *Why:* product: "everything persists … terminal processes don't survive a restart".
- **D2 – Storage:** one JSON file, `drovr-state.json`, in Electron's `userData` directory, owned by main. Main writes it atomically (write `drovr-state.json.tmp`, then rename over the file), so a crash mid-write leaves the previous version intact. The file holds `{ "version": 1, "state": <WorkspaceState> }`. No new dependency. *Why:* round 1 Q1; the state is a few KB, always read and written whole; SQLite (better-sqlite3) would add a second native module and a stack change for no query need. Recorded as an addendum to ADR 0001.
- **D3 – Validation:** a pure core function parses the file's contents into a `WorkspaceState` or rejects it. It accepts only version 1 with every field of D1 present and well typed (startup commands pass `checkStartup`), every card's `columnId` naming a column of its workspace, unique ids, and an `activeId` that is null exactly when there are no workspaces and otherwise names one. Anything else (not JSON, another version, a broken invariant) is rejected as a whole; there is no partial repair. *Why:* a half-loaded board is worse than an obviously empty one with the data kept aside (D4).
- **D4 – Unreadable file:** when the file exists but is rejected (D3), main renames it to `drovr-state.corrupt-<UTC timestamp, e.g. 20261013T141500Z>.json` in the same directory and the app starts with an empty board (the empty state). No dialog. A missing file is a first launch: empty board, nothing renamed. A file that exists but can't be read (permissions, I/O error) is treated as rejected and moved aside the same way; if moving it aside fails, the app starts with an empty board and writes nothing for the rest of the session (logged), so the file is never overwritten. *Why:* round 1 Q3; round 2 Q1 (during S2 review); the app stays usable and nothing is destroyed.
- **D5 – Load:** the renderer asks main for the saved state once, before it first renders the board, through a new invoke channel `state:load`, and seeds the store with it (`InMemoryWorkspaceStore` gets an initial state). A new window (macOS `activate` after all windows closed) loads again and gets main's latest state. *Why:* the renderer stays the owner of the model (#2 D4); main only stores.
- **D6 – Save:** the store's subscriber sends the whole state to main on every change through a new send channel `state:save`. Main validates it with D3 (an invalid payload is ignored and nothing is written), keeps it as the latest state, and writes the file at most once every 200 ms (the last state wins). On `before-quit`, main writes any pending state synchronously before the existing `killAll`. *Why:* round 1 Q4: a crash loses at most ~200 ms of edits, and Cmd+Q loses nothing.
- **D7 – IPC boundaries:** `state:load` and `state:save` accept only a window's own top-level frame, as `fs:isDirectory` does. They are typed in `src/shared/api.ts` as `window.drovr.state` (`load(): Promise<WorkspaceState>`, `save(state): void`). contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md.
- **D8 – Ids:** the renderer's store generates workspace, column and card ids with `crypto.randomUUID()`, not the in-memory counter, so ids created after a restore never collide with restored ones. Restored ids are kept. *Why:* the counter restarts at 1 every launch.
- **D9 – Restored cards are Stopped:** after a restart no card has a process. A card the card registry doesn't know yet (never started in this run) shows the status `Stopped`, on the board and wherever its status shows, and is offered the actions of a Stopped card (no `Close`, deleting asks nothing, not counted as running). Opening it starts it with its startup command (#5 D7): a Shell card runs a shell in its own directory; a Claude Code card with `claudeStarted` runs `claude --resume <id> || claude --session-id <id>`. A card whose directory is gone shows `Couldn't start: working directory not found` once opened (#5 D8). *Why:* round 1 Q2; product: "a card whose process is gone shows as exited and can be restarted".
- **D10 – Launch view:** the app opens on the board of the saved active workspace, never on a card's full-size view, and starts no processes. *Why:* round 1 Q5; starting an agent should be the user's choice.
- **D11 – Test data directory:** when the environment variable `DROVR_USER_DATA_DIR` is set, main uses it as `userData` (set before the app is ready). The smoke tests give every test its own temp directory this way, so tests never share or touch a real board. *Why:* each smoke test needs a fresh, isolated board; a restart test needs the same directory across two launches.

## Acceptance criteria

Workspace `alpha` has working directory `/tmp/drovr-alpha` (an existing directory), unless stated otherwise. Each scenario launches the app with `DROVR_USER_DATA_DIR` set to a fresh temp directory and "restarts" by closing the app and launching it again with the same directory.

- **AC1 – Board survives a restart:** Given workspaces `alpha` and `beta` (`/tmp/drovr-beta`), `beta` active, `alpha`'s columns renamed and reordered to `Todo, Doing, Done` (Backlog renamed to `Todo`, `Running` renamed to `Doing`, `Needs me` deleted), and in `alpha` cards `api` and `web` in `Doing` (in that order, `web` moved there by drag) and `db` in `Todo`, when the app restarts, then the sidebar lists `alpha` and `beta` with `beta` active and its board shown, and `alpha`'s board shows columns `Todo, Doing, Done` with `db` in `Todo` and `api` above `web` in `Doing`.
- **AC2 – Card details survive:** Given in `alpha` a card renamed to `server`, a card created with startup command Custom `npm run dev`, workspace default startup command `Claude Code`, and a card whose directory is `/tmp/drovr-alpha` created before `alpha`'s directory was changed to `/tmp/drovr-beta`, when the app restarts, then the titles, the card's `Startup command…` dialog (Custom, `npm run dev`), `alpha`'s edit dialog (directory `/tmp/drovr-beta`, default `Claude Code`) are as before, and opening the older card and running `pwd` prints `/tmp/drovr-alpha`.
- **AC3 – Restored cards are Stopped:** Given cards `api` (running) and `old` (Stopped) in `alpha`, when the app restarts, then both read `Stopped`, no shell process was started, neither card's menu has `Close`, deleting `api` asks nothing, and deleting `alpha` with only Stopped cards asks no running-terminal question (#5 D13 wording absent).
- **AC4 – Opening resumes:** Given Shell card `sh` and Claude Code card `agent` (fake `claude`, started once before the restart, agent session id `<U>`), when the app restarts and the user opens `sh` and runs `pwd`, then it prints `/tmp/drovr-alpha`; and when the user opens `agent`, then `claude --resume <U> || claude --session-id <U>` runs and the fake claude log's last line is `--resume <U>`.
- **AC5 – Default titles continue:** Given cards `Terminal 1` and `Terminal 2` created with empty titles in `alpha`, when the app restarts and the user creates a card with an empty title, then it is `Terminal 3`; new workspaces, columns and cards created after the restart work (rename, move, delete) alongside the restored ones.
- **AC6 – Saved without a clean quit:** Given a card `api` created in `alpha`, when the app's main process is killed (SIGKILL) at least 1 s later and the app is launched again, then `api` is on the board.
- **AC7 – Unreadable file:** Given `drovr-state.json` in the data directory contains `{not json`, when the app launches, then it shows the empty state, the data directory holds a file matching `drovr-state.corrupt-*.json` with content `{not json`, and creating a workspace then saves a new valid `drovr-state.json`. The same holds for `{"version": 2, "state": {}}`.
- **AC8 – Launch view:** Given card `api` open at full size when the app quits, when it restarts, then the board of `alpha` is shown, not the full-size view, and `api` reads `Stopped`.
- **AC9 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass; existing smoke tests run each in their own data directory.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Saved-state format (core):** a plain-TS module that serialises a `WorkspaceState` to the version-1 file shape and parses file contents back, rejecting per D3; the corrupt-copy file name for a timestamp (D4). `InMemoryWorkspaceStore` accepts an initial state. Vitest: round trip of a full state; each rejection case (not JSON, version 2, missing field, bad startup, card in unknown column, duplicate id, dangling `activeId`, `activeId` null with workspaces); store seeded with a state continues `nextCardNumber`. Satisfies D1, D3, D4 (name).
2. **S2 – State file in main (core + main):** a core state-file writer, with an injected fs, that loads (missing → empty, rejected → renamed aside → empty), coalesces saves to one write per 200 ms with atomic temp-and-rename, and flushes synchronously; main wires it to `userData` (honouring `DROVR_USER_DATA_DIR`), registers `state:load` / `state:save` with the main-frame check, and flushes on `before-quit`; the preload exposes `window.drovr.state`. Vitest with a fake fs and fake timers: load cases, coalescing (three saves within 200 ms → one write of the last), flush, temp-then-rename order, invalid save ignored. Satisfies D2, D4, D6, D7, D11.
3. **S3 – Renderer loads and saves, cards restore Stopped:** the renderer loads the state before first render and seeds the store, subscribes to save on change, uses UUID ids; cards the registry doesn't know show `Stopped` and get Stopped behaviour (menu, deletes, running count); launch shows the active workspace's board. Every existing smoke test launches with its own `DROVR_USER_DATA_DIR` (one shared launch helper rather than copies); new `e2e/persistence.spec.ts` covers AC1–AC8; `AGENTS.md`'s smoke test list and ADR 0001 (addendum: JSON file, D2) are updated; `CONTEXT.md` gets **Saved state**. Satisfies AC1–AC9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (S1 round trip) + e2e | Build the board, restart with the same data dir, read sidebar, columns and card order |
| AC2 | unit (S1) + e2e | Restart; read titles, startup dialog, workspace dialog; `pwd` in the older card |
| AC3 | e2e | Restart; status labels, card menu, delete card and workspace dialogs; no PTY spawned |
| AC4 | e2e (fake `claude`) | Restart; open `sh` and run `pwd`; open `agent`, read the fake claude log |
| AC5 | unit (seeded store) + e2e | Restart; create a card with an empty title; create, rename, move, delete after restore |
| AC6 | unit (S2 coalescing) + e2e | Create a card, wait 1 s, SIGKILL the main process, relaunch |
| AC7 | unit (S2 load cases) + e2e | Write the bad file, launch, list the data dir, create a workspace, read the new file |
| AC8 | e2e | Quit with a card open at full size; relaunch; board visible |
| AC9 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS that the board survives Cmd+Q and relaunch of the packaged app, and that a Claude Code card resumes its conversation after the restart.

## Stack changes

None: a JSON file written with Node's `fs` adds no dependency, database or service; `.factory/stack.json` keeps `database: none`.

## Data and migrations

New file `<userData>/drovr-state.json`: `{ "version": 1, "state": WorkspaceState }` with `WorkspaceState` as defined in the workspace store (D1). No existing data: earlier builds kept nothing. Later model changes bump `version` and add a migration from the previous version in the S1 module; until then, an unknown version is treated as unreadable (D4).

## Out of scope

- Persisting terminal scrollback, screens, status lines or processes; auto-starting cards at launch.
- Reopening the card that was open at full size.
- Window size and position, sidebar collapse state or other UI preferences.
- Repairing a partly valid file, a UI notice about a corrupt file, or backups beyond the corrupt copy.
- Sync between machines; export and import.

## Open questions

None.
