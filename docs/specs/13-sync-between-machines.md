---
item: 13
type: feature
title: Sync between machines
status: approved
branch: claude/13-sync-between-machines
---

# Sync between machines

## Problem

A developer who runs Drovr on more than one Mac (a desktop and a laptop) keeps a separate board on each, so the workspaces, columns and cards they set up on one are missing on the other. After this ships they point Drovr on every machine at the same **sync folder** (one their own file sync tool already carries: iCloud Drive, Dropbox, Syncthing…), and the board follows them: a workspace, column or card created, renamed, moved or deleted on one machine shows up on the others, live while both are open. Processes never move: a synced card is `Stopped` on a machine until it is opened there. Builds on #8 (saved state) and #10 (settings), both merged.

## Domain decisions

- **D1 – Transport: a sync folder.** The user picks a folder; Drovr reads and writes one file in it, `drovr-board.json`, and nothing else. Getting the file from machine to machine is the user's sync tool's job; Drovr runs no server, needs no account and opens no network connection. Conflict copies a sync tool makes (`drovr-board (conflicted copy).json` and the like) are ignored. *Why:* round 1 Q1: no new service, cost or stack change; git (credentials, merges) and a Drovr server (hosting, money) were rejected, and manual export/import isn't sync.
- **D2 – What syncs: the board.** Every workspace (id, name, directory, host, columns in order, cards in board order, `nextCardNumber`, default startup command) and every card (id, column, title, directory, host, startup command, agent session id). Not synced: which workspace is active, settings (theme, font, the sync folder itself), processes, screens, scrollback, agent status, panes, window size, the collapsed sidebar. *Why:* round 1 Q2: fonts and themes often differ per screen and the active workspace is what you look at on this machine; processes can't move.
- **D3 – Sync file format.** `{"version":1,"savedAt":"<ISO 8601 UTC>","board":{"workspaces":[…]}}`, where every workspace and card has D2's fields in the saved-state shape of #8 D1 (plus #12 D10's `host`), with `claudeStarted` mapped by D6 and local directories by D5. A file is valid when it is JSON, `version` is 1, `savedAt` is a valid date and `board` passes the saved-state validation of #8 D3 (with `activeId` taken as the first workspace's id, or null when there are none) once D5 has expanded its directories. Anything else is **unreadable** (D11).
- **D4 – Writing the file.** Main writes the sync file atomically in the folder (`drovr-board.json.tmp`, flushed, then renamed over it, as #8 D2) within 1 second of a board change, but only when the board it would write differs from the last board it read from or wrote to the file (compared as D3's `board`, `savedAt` aside). *Why:* round 1 Q8; the comparison keeps two open machines from echoing each other's writes forever.
- **D5 – Local directories across machines.** When writing, a local workspace's or card's directory equal to this machine's home directory is written as `~`, and one under it as `~/<rest>`; any other local path is written as it is. When reading, a local directory `~` or `~/<rest>` is expanded to this machine's home. SSH directories (#12 D3) are written and read unchanged. A local card whose directory doesn't exist on this machine shows `Couldn't start: working directory not found` when opened, as today (#4). *Why:* round 1 Q3: covers the same repo layout under different user names without per-machine overrides.
- **D6 – Claude Code across machines.** For an SSH card `claudeStarted` is synced as it is (the conversation lives on the host every machine reaches). For a local card it is written as `false` and, when reading, a card this machine already has keeps this machine's value while a card new to this machine gets `false`, so its first start here runs `claude --session-id <agent session id>` (#5) rather than `--resume`. *Why:* round 1 Q6: Claude Code keeps local conversations on the machine that ran them, so resuming another Mac's conversation would fail with "no conversation found".
- **D7 – Last writer wins, applied live.** Whenever main reads a valid sync file whose board differs from the last board it read from or wrote to the file, that board replaces this machine's whole board (in the renderer's store, and so in `drovr-state.json`), keeping this machine's own state: the active workspace stays active if it still exists, else the first workspace becomes active (or none); D6's local `claudeStarted`; every running card (D8). Columns, order, titles, startup commands and deletions all come from the file. *Why:* round 1 Q4: one developer uses one machine at a time, so whole-board last-writer-wins is simple and predictable; per-item merging and Push/Pull buttons were rejected.
- **D8 – A running card is never removed from elsewhere.** If the incoming board lacks a card that is running on this machine (`Running`, any status that isn't `Stopped`, `SSH failed` or `Couldn't start`), the card stays: in its column at the bottom if the column still exists, else at the bottom of its workspace's first column; if its whole workspace is gone, the workspace as this machine had it stays, with all its cards, appended after the incoming workspaces. The resulting board then differs from the file, so D4 writes it back. Nothing on this machine is stopped or killed by a sync. A card running here whose other fields changed remotely (title, column, startup command) takes the incoming values and keeps running.
- **D9 – Turning sync on joins the boards.** When the sync folder is set (D10) and the folder has no `drovr-board.json`, this machine's board is written to it. When it has a valid one, the two boards are joined: the file's workspaces in their order, then this machine's workspaces whose id the file lacks, in their order; a workspace in both is taken from the file (D7, D8 apply to it). The joined board replaces this machine's and is written to the file. When the folder is unavailable or its file unreadable at that moment, the join stays owed: it runs on the first read that finds the folder available with a valid file (or no file, which writes this machine's board), instead of D7's replace or D12's write. *Why:* round 1 Q5; the owed join is round 2 Q1 (implementation): ids are random UUIDs (#8 D8), so two machines' workspaces never collide, and joining loses nothing without a dialog.
- **D10 – Sync folder setting.** The Settings dialog (#10 D5) gets a `Sync folder` section below Font family: a text field (`data-testid="settings-sync-folder"`, placeholder `Off`), a `Choose…` button (`settings-sync-choose`, the native folder picker, which fills the field and applies it) and, while sync is on, a `Turn off` button (`settings-sync-off`). A typed path applies on blur or Enter, like Font family: main checks it is an absolute path to an existing directory, else shows `Folder not found` under the field (`settings-error-sync-folder`) and keeps the previous folder. An empty field also turns sync off. The folder is kept per machine in `drovr-settings.json` as `syncFolder` (an absolute path; left out of the file while sync is off, the default); it is never synced. A settings file without it, or with an invalid value, loads as `null` with the other fields kept (#10 D7). `settings:save` never changes it: only the sync channels do (D13). Changing to another folder runs D9 against the new folder. Turning sync off leaves this machine's board as it is and stops reading and writing the folder. *Why:* round 1 Q7.
- **D11 – When main reads.** With sync on, main reads the sync file at launch (before the renderer's first `state:load` is answered, so the window opens on the synced board without a flash of the old one), when the folder's contents change (a watch on the folder, since sync tools replace the file by renaming), and whenever a Drovr window gains focus. A launch read applies D7 (it is not a join: D9 runs only when the folder is set). Main's last read or written board is kept in memory only; after a restart the first read compares with nothing, so a valid file always applies at launch.
- **D12 – Folder unavailable or file unreadable.** When the folder is missing, isn't a directory, or a read or write fails, the status is `Sync folder unavailable` and board changes are kept locally as always; main retries on the next change, folder event or focus, and on success writes this machine's board if it changed since the last sync, else applies the file (D7). When the file is unreadable (D3), the status is `Sync file unreadable`, this machine's board stays as it is, and main never writes the file until it becomes valid again or the folder changes: a newer Drovr's or a damaged file is never overwritten. Changes made while the folder is unavailable that Drovr quits before writing are lost to the file at the next launch's read (D11). *Why:* folders on removable or network drives come and go; the unreadable rule mirrors #8 D4's never-overwrite.
- **D13 – Sync status.** Main owns the status and sends every change to the renderer: `off`, `synced` (with the time of the last successful read or write), `unavailable` or `unreadable`. The sidebar shows it on one line above the Settings button (`data-testid="sync-status"`) as `Synced HH:MM` (local 24-hour time), `Sync folder unavailable` or `Sync file unreadable`, and nothing when sync is off or the sidebar is collapsed; the Settings dialog shows the same line under the Sync folder field (`settings-sync-status`). *Why:* round 1 Q9: a silent failure would quietly fork the boards.
- **D14 – IPC.** `window.drovr.sync` (typed in `src/shared/api.ts`): `status(): Promise<SyncStatus>`, `onStatus(listener)`, `setFolder(path: string | null): Promise<{ ok: true } | { ok: false; reason: 'not found' }>` (null turns sync off), `pickFolder(): Promise<…same…>` (opens the picker; cancelled resolves `{ ok: true }` and leaves everything as is), and `onBoard(listener)`, through which main hands the renderer a board to apply (D7, D9). The renderer answers by applying it (D8) and saving through `state:save` as for any change; main writes the sync file from those saves (D4). All accept only a window's own top-level frame, as `state:load` does (#8 D7). The renderer's store gains one operation, replacing the whole board while keeping the active workspace when it still exists.
- **D15 – Test seams.** `DROVR_HOME_DIR`, when set, replaces the home directory D5 maps (so a test can give two instances two homes). The smoke tests run two instances at once with their own `DROVR_USER_DATA_DIR` (#8 D11, D12) and one shared temp sync folder.

## Acceptance criteria

- **AC1 – Turning sync on with an empty folder:** Given workspace `api` with columns Backlog, Running, Needs me, Done and card `Terminal 1` in Backlog, and an empty folder F, when the user types F into Sync folder in Settings and presses Enter, then within 2 s `F/drovr-board.json` exists with `version` 1, one workspace `api` with that card, no `activeId`, and the sidebar shows `Synced HH:MM`.
- **AC2 – A change reaches the other machine live:** Given instances A and B both synced to F and showing workspace `api`, when A renames `Terminal 1` to `server` and moves it to Running, then within 5 s B's board shows `server` in Running, `Stopped`, with no process started on B.
- **AC3 – Join on turning sync on:** Given F holds A's board with workspace `api`, and B has its own workspace `web` and no sync folder, when B sets its sync folder to F, then B shows both `api` and `web` (in that order) with `web` still active, and within 5 s A shows `api` and `web` too.
- **AC4 – Deletions win, running cards stay:** Given A and B synced, both with cards `one` and `two` in `api`, and `two` running on B, when A deletes `one` and `two`, then B no longer shows `one`, still shows `two` `Running` at the bottom of its column with its process alive, and A shows `two` again (written back by B).
- **AC5 – Home directories map:** Given A with home `/tmp/ha` and B with home `/tmp/hb` (`DROVR_HOME_DIR`), when A creates a local workspace with directory `/tmp/ha/proj`, then the sync file holds `~/proj` and B's workspace shows directory `/tmp/hb/proj`; an SSH workspace with directory `~/srv` on `devbox` reaches B unchanged.
- **AC6 – Claude Code across machines:** Given a local Claude Code card that A has started (A's `claudeStarted` true) and an SSH Claude Code card A has started, when B (with the fake `claude` and fake `ssh`) opens each, then the local card runs `claude --session-id <id>` and the SSH card runs `claude --resume <id>`.
- **AC7 – Active workspace stays per machine:** Given A and B synced with workspaces `api` and `web`, A on `api` and B on `web`, when A renames `api` to `api2`, then B still shows `web` active; and when A deletes `web`, B shows `api2` active.
- **AC8 – Launch reads the folder:** Given B quit while A, still running, renamed card `x` to `y`, when B launches, then B's first board render shows `y`, not `x`.
- **AC9 – Unavailable folder:** Given A synced to F, when F is removed, then within 5 s (or on window focus) the sidebar shows `Sync folder unavailable`, board changes still persist across a restart of A, and when F is recreated A writes its board there and shows `Synced HH:MM`.
- **AC10 – Unreadable file is never overwritten:** Given A synced to F, when `F/drovr-board.json` is replaced with `not json`, then A shows `Sync file unreadable`, keeps its board, and after A creates a card the file still reads `not json`.
- **AC11 – Bad folder and turning off:** Given Settings open, when the user types `/no/such/dir` into Sync folder and presses Enter, then `Folder not found` shows under the field and sync stays as it was; when the user presses `Turn off`, the field is empty, the sidebar shows no sync line, and later board changes no longer change `F/drovr-board.json`.
- **AC12 – Setting kept per machine:** Given A synced to F, when A restarts, then Settings shows F and the sidebar shows `Synced HH:MM`; `drovr-settings.json` holds `"syncFolder": "<F>"`, and the sync file holds no `syncFolder`, theme or font. A settings file from #10 without `syncFolder` loads with sync off and its theme and font kept.
- **AC13 – No echo:** Given A and B synced and idle, when A makes one change, then `F/drovr-board.json` is written at most once by A and at most once by B (B only when D8 changed the board), and is not written again over the next 5 s.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Sync folder setting and writing the board:** `syncFolder` in the settings file and its validation; the core sync-file module (D3 format and validation, D5 home mapping, D6 `claudeStarted`, D4 comparison and atomic write with an injected fs, like `StateFile`); main's sync module writing the board from every `state:save`; the Sync folder section in Settings (field, Choose…, Turn off, `Folder not found`); the status line in the sidebar and Settings; D9's join when the folder is set (applied through `onBoard`, with the store's replace operation keeping the active workspace); `DROVR_HOME_DIR`. Satisfies AC1, AC3, AC5 (writing side), AC11, AC12.
2. **S2 – Reading changes live:** main's reads at launch, on folder changes and on focus (D11) with D7's apply; the renderer keeping running cards (D8) and local `claudeStarted` (D6); no echo (D4). Satisfies AC2, AC4, AC5, AC6, AC7, AC8, AC13.
3. **S3 – Failures:** unavailable folder and recovery, unreadable file never overwritten (D12), with their status lines. Satisfies AC9, AC10.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (sync file serialize) + e2e `e2e/sync.spec.ts` | type F in Settings → Sync folder, Enter; read `F/drovr-board.json`; check the sidebar line |
| AC2 | e2e (two instances) | A renames and moves a card; B's board shows it, `Stopped` |
| AC3 | unit (join) + e2e | B with `web` sets F; both show `api`, `web` |
| AC4 | unit (apply keeping running cards) + e2e | start `two` on B, delete both on A; B keeps `two` running, A gets it back |
| AC5 | unit (home mapping) + e2e with `DROVR_HOME_DIR` | create `/tmp/ha/proj` on A; read the file; open B's workspace dialog |
| AC6 | unit (claudeStarted mapping) + e2e with fake `claude` and fake `ssh` | open both cards on B; check the fake `claude` log |
| AC7 | unit (store replace) + e2e | rename and delete on A; check B's active workspace |
| AC8 | e2e | quit B, rename on A, launch B; first board shows `y` |
| AC9 | unit (status transitions, injected fs) + e2e | remove F; check the line; recreate F; check the file and line |
| AC10 | unit + e2e | write `not json`; create a card on A; file unchanged |
| AC11 | unit (folder check) + e2e | bad path, then Turn off |
| AC12 | unit (settings file) + e2e | restart A; Settings and sidebar; read both files |
| AC13 | unit (write comparison) + e2e (file mtime/write count) | one change, wait 5 s, count writes |

## Stack changes

None. Node's `fs` (including its folder watch) and Electron's existing folder picker cover it; no new dependency, service or hosting.

## Data and migrations

- `drovr-settings.json` gains `syncFolder` (absolute path, written only while sync is on), still version 1; existing files load with sync off and keep their other fields.
- New file `drovr-board.json` in the user's sync folder (D3). Nothing is written there until the user sets a folder.
- `drovr-state.json` is unchanged in format; with sync on it holds the synced board plus this machine's active workspace and `claudeStarted` values.

## Out of scope

- A Drovr server, accounts, or syncing over the network by Drovr itself (D1).
- Merging concurrent edits per item; resolving a sync tool's conflict copies (D1, D7).
- Syncing settings, processes, scrollback, panes or agent status (D2).
- Per-machine directory overrides beyond the home mapping (D5).
- Choosing which workspaces sync: with sync on, all of them do.
- Moving a local Claude Code conversation between machines (D6).

## Open questions

None.
