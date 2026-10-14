---
item: 26
type: chore
title: 'Async I/O for the sync folder'
status: approved
branch: claude/26-async-sync-io
---

# Async I/O for the sync folder

## Problem

#13's sync folder (`SyncFolder` in core, wired by main's sync module) reads and writes `drovr-board.json` with blocking fs calls (`readFileSync`, `statSync`, `openSync`/`writeFileSync`/`fsyncSync`/`renameSync`) on Electron's main process: at launch, on every board change, on every folder event, whenever a window gains focus, and every 2 s while the folder is unavailable (#13 D12). A sync folder on a stalled network mount, or an iCloud placeholder that downloads on read, blocks main for as long as the call takes, which freezes the window's IPC and every card's terminal traffic. Parent: #13.

The fix moves the sync folder to Node's async fs, keeping #13's behaviour: D4 (written only when the board differs from the last read or written, so machines never echo), D7 (last writer wins), D9 (the join when sync is turned on, owed while the folder isn't ready), D11 (launch read before the window's first `state:load`), D12 (the file is re-read before every write and an unreadable one is never written over).

## Decisions

- **D1 – Async fs.** `SyncFolder` takes an injected async fs (the `node:fs/promises` shapes it needs: read a file, stat, open a file handle and write, sync and close it, rename) instead of the sync one, and main passes `node:fs/promises`. The folder watch (`fs.watch`) stays as it is. The atomic write keeps #13 D4's temp file, flushed, then renamed over the file. *Why:* async fs runs on libuv's thread pool, so a stalled call never blocks main's event loop; it is the smallest change that keeps the core module plain TS with an injected fs, unit-tested with fakes.
- **D2 – One operation at a time.** Every sync operation (set folder, launch read, read, the timer's write, flush) runs on one internal queue in `SyncFolder`, each to completion before the next starts, so each sees and leaves the same state the synchronous code did: a write still re-reads the file first in the same operation (D12), and `last` is compared and updated as before (D4). The public operations return promises; `noteBoard` stays synchronous bookkeeping (it notes this machine's board, sets the pending board and starts the write timer, whose write is queued). *Why:* interleaved async steps would let a read and a write race on `last` and break D4's no-echo and D12's never-overwrite; a queue keeps the existing state machine as is.
- **D3 – Reads coalesce.** A read asked for while a read is already waiting in the queue (not yet started) is not queued again; its caller gets null (nothing to apply): the waiting read's own caller applies what it finds, once. So focus events, folder events and the 2 s unavailable retry never pile up operations behind a stalled call: at most one read runs and one waits. *Why:* a stalled mount would otherwise grow the queue every 2 s forever.
- **D4 – Launch read, bounded.** Main starts the launch read at once, as now, and `state:load` waits for it before answering, but for at most `SYNC_LAUNCH_WAIT_MS` = 1000 ms. A launch read that finishes later applies its board as any read does (main's state and every window through `sync:board`; the renderer already keeps a board that arrives before its store is loaded). The status stays as it was (`off` at launch) until that read finishes. When a late launch read finds a valid file but this machine's board changed since launch (the user worked while the read stalled), this machine's board wins and is written, as D12's recovery; with no change since launch the file applies (#13 D11). Either way the board the launch read leaves is the one a later join (#13 D9) starts from. *Why:* D11's "window opens on the synced board" holds for any folder that answers within a second; a stalled one must not keep the window from opening.
- **D5 – Quit waits, bounded.** `flush` writes a pending board now (queued behind any running operation) and resolves once the queue is empty. The first quit is held (as #18 D2's hold for live shells) while the sync folder has a pending board or a running operation, until it is done or `QUIT_WAIT_MS` passed, whichever comes first, alongside the shells' wait. A later quit during or after the hold flushes again and, if sync is still busy, holds once more for at most `QUIT_WAIT_MS`; a third goes through. When the app is quitting (Electron's `quit` event, after `will-quit` has cleaned up the `board` sockets) and the sync folder is still busy, main logs it and SIGKILLs its own process: a libuv worker blocked in a stalled fs call keeps the process from ever ending (libuv waits for its pool threads at exit), which would also keep the single-instance lock (#8 D12) so a relaunch would hand over to a dead app. Main's state and settings are flushed synchronously before then, and every shell has been killed. *Why:* a change made just before quit still reaches the file (as the synchronous flush did), and a stalled folder can delay quit by a bounded time only (ruled under full auto during S2).
- **D6 – Setting the folder.** `sync:setFolder` and `sync:pickFolder` resolve once the queued set-folder operation (D10's write of a pending change to the old folder, then D9's join) has finished, as now; the window stays responsive meanwhile. The folder is kept in the settings only once that operation has finished, so a set-folder stuck behind a stalled old folder that never runs (quit) leaves the old folder in the settings rather than a new folder whose join never ran. After quit's flush, main no longer watches or retries the folder.

## Acceptance criteria

- **AC1 – A stalled folder freezes nothing:** Given a sync folder whose `drovr-board.json` is a FIFO with no writer (a read that never returns) kept in the settings, when Drovr launches, then its window opens with the local board, a new card's shell echoes `echo ok-$((40+2))` as `ok-42`, and focusing the window again changes none of that. When a valid board from another machine is then written into the FIFO, the window keeps this machine's board with its new card (it changed since launch, D4), the sync file then holds that board, and the status reads `Synced HH:MM`. (e2e `e2e/sync.spec.ts`; the unchanged-board case, where the file's board applies, is a unit test)
- **AC2 – Operations don't interleave:** Given a read whose file read has not returned, when a board change is noted and its write timer fires, then nothing is written until the read has finished; when that read found a newer valid board than the last one, the pending older change is dropped and the newer board is handed over (D7), and nothing is written (D4). (unit `src/core/sync-folder.test.ts`, fake async fs with deferred reads)
- **AC3 – Never overwrite holds:** Given a pending change and a file that becomes unreadable before the write's re-read, when the write runs, then the file is not written and the status is `unreadable`. (unit)
- **AC4 – Reads don't pile up:** Given a read that has not returned, when ten more reads are asked for (focus, folder events, retries), then the fs sees one file read in flight, and exactly one more once the first returns; a board the second read finds is handed to one caller only. (unit)
- **AC5 – Launch is bounded:** Given a launch read that has not returned, `state:load` answers within `SYNC_LAUNCH_WAIT_MS` with the local board; given one that returns at once, the window's first board is the file's (#13 AC8 unchanged). (unit for the bound on the launch gate; e2e AC1 and #13 AC8)
- **AC6 – Quit writes a pending change:** Given a board change made less than `SYNC_WRITE_DELAY_MS` before quit, the file holds it after the app exits; given a stalled folder (the FIFO left unfed), the app's process has ended within 2 × `QUIT_WAIT_MS` plus 5 s of the first quit. (unit for `flush` and the hold decision; e2e)
- **AC7 – No regressions:** `.claude/check.sh`, `xvfb-run -a npm run test:smoke` (all of `e2e/sync.spec.ts` included) stay green; no `*Sync` fs call is left in the sync folder's code.

## Slices

1. **S1 – Async SyncFolder:** D1–D3 and D5's `flush` in the core module, its unit tests ported to the async fs and the queue (AC2–AC4, AC6's unit part). Main's sync module passes `node:fs/promises` and awaits the operations. Satisfies AC2, AC3, AC4.
2. **S2 – Launch and quit in main:** D4's bounded launch gate on `state:load`, D5's quit hold, D6, and the FIFO e2e. Satisfies AC1, AC5, AC6, AC7.

## Test seams and verification

| AC | Test seam | How to verify |
|---|---|---|
| AC1 | e2e `e2e/sync.spec.ts` | `xvfb-run -a npx playwright test e2e/sync.spec.ts -g "#26"` |
| AC2–AC4 | unit `src/core/sync-folder.test.ts` | `npm test` |
| AC5 | unit + e2e | `npm test`; #13 AC8 in `e2e/sync.spec.ts` |
| AC6 | unit + e2e | `npm test`; e2e AC1 exits |
| AC7 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke`, `grep -n "Sync(" src/core/sync-folder.ts src/main/sync.ts` |

## Stack changes

None.

## Data and migrations

None: the sync file's format and location are unchanged.

## Out of scope

- A status for "still reading" (a stalled read shows the last known status) and a timeout that calls a stalled folder unavailable.
- The saved-state and settings files in `userData` (local disk, not a sync folder).
- Moving the sync folder to a worker thread.

## Open questions

None.
