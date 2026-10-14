---
item: 16
type: feature
title: Terminal output flow control (backpressure)
status: approved
branch: claude/16-terminal-flow-control
---

# Terminal output flow control (backpressure)

## Problem

Every card is a live terminal, and many of them stream at once. Today main forwards every chunk a PTY prints straight to the renderer (`terminal:data`), with nothing that slows a shell down when xterm.js can't keep up. #1's benchmark showed what that does: with unthrottled output (`yes | cat -n`) in 10 cards the renderer falls behind by megabytes, its fps drops to about 8 and 16 of 20 typed characters never echo within 2 s, while the main process stays responsive. After this ships, a shell that prints faster than its screen can parse is paused until the screen catches up (the scheme VS Code's terminal uses with the same node-pty + xterm.js stack), so the backlog per session stays bounded, typing still echoes, and output is never lost. Parent: #1 (D8 performance budget).

## Domain decisions

- **D1 – Ack-based flow control:** main counts, per PTY session, the characters it sent to the renderer that the renderer hasn't acknowledged yet (`unacked`). The renderer acknowledges characters once the session's screen has parsed them (xterm's write callback). When `unacked` rises above the **high watermark**, main pauses the PTY (node-pty `pause()`: it stops reading, so the shell blocks on its next write once the kernel buffer is full); when acknowledgements bring it below the **low watermark**, main resumes it. Output is never dropped, reordered or coalesced away. *Why:* round 1 Q1: only pausing bounds the backlog (and so echo latency and memory) without losing output; batching alone doesn't bound it, dropping loses output.
- **D2 – Thresholds:** high watermark 100,000 characters, low watermark 5,000, and the renderer sends an acknowledgement for a session once it has 5,000 or more unacknowledged-but-parsed characters for it (so whatever it holds back is always below the low watermark). Characters are counted as JavaScript string length (UTF-16 code units) on both sides. The three values are named constants in one plain core module shared by main and renderer. *Why:* round 1 Q2: VS Code's proven values.
- **D3 – New IPC channel `terminal:ack`:** renderer → main, `(sessionId, chars)`, fire-and-forget like `terminal:write`. Main accepts it only from the window's main frame that owns the session (the same `ownedBy` check as `write`, `resize`, `kill`) and only when `chars` is a positive safe integer; anything else is ignored. `unacked` never goes below 0, so an over-acknowledgement can only resume a paused PTY early, never break it. The preload exposes it as `window.drovr.terminal.ack(id, chars)`, typed in `src/shared/api.ts`. contextIsolation on, nodeIntegration off, sandbox on. *Why:* a channel's input is untrusted; the renderer is the only party that knows what xterm has parsed.
- **D4 – Every chunk is acknowledged exactly once:** the renderer acknowledges a chunk when the screen it was routed to (a card's main pane or an extra pane, #11) has parsed it, including chunks that arrived before the spawn reply and are replayed on adoption (`SessionRouter` early events). A chunk nobody will ever parse (no route and no spawn pending, early events discarded, a screen disposed or the session released before its write callback ran) is acknowledged at once. The acknowledgement batching of D2 is per session; a session's pending count is dropped when the session ends. *Why:* a chunk never acknowledged would leave its PTY paused forever.
- **D5 – A paused shell still stops:** killing a session (Close #7, delete, the main pane's stop ending extra panes #11 D6, a page reload or window close, `killAll` on quit) resumes its PTY first if paused, so the shell sees its hangup and the session's exit arrives as before (Stopped, `SSH failed` for an SSH card's 255 #12 D7). A session that exits by itself while paused is likewise never kept alive by the pause. *Why:* node-pty reads to EOF before reporting exit; a paused PTY could otherwise hang the card in `Running`.
- **D6 – Invisible to the user:** no UI, status or setting for flow control; a paused card reads `Running` as before, its status line keeps updating as its screen catches up (#4 D9), input is still written to a paused PTY at once (only output is held back). SSH cards (#12) get the same flow control on their local `ssh` process, which in turn slows the remote side through TCP. *Why:* round 1 Q4: pauses last milliseconds.
- **D7 – Benchmark budget per profile:** `npm run benchmark` keeps the full D8 budget (#1) for the default `sustained` profile. With `BENCH_PROFILE=firehose` it must have zero dropped echoes, every session producing output and every card's status line showing its own output, and main event-loop lag p99 within 100 ms; renderer fps and echo max are reported in the results table as info (not asserted). The table gains a row with the most characters any session had unacknowledged in main during the measurement (info, with the high watermark next to it). *Why:* round 1 Q3: flow control bounds the backlog, which fixes the dropped echoes; it can't make 10 unthrottled parsers cheaper, so fps under firehose would need a separate renderer scheduler (out of scope).

## Acceptance criteria

Workspace `alpha` with working directory `/tmp/drovr-alpha` (an existing directory), default columns, default startup command `Shell`; card `api` in `Running`, open at full size, unless stated otherwise.

- **AC1 – Flow control logic:** Given a session's flow-control state in main, when 100,001 characters are sent with no acknowledgement, then the PTY is paused exactly once; when 95,001 characters are then acknowledged (leaving 5,000), it stays paused; when 1 more is acknowledged, it is resumed exactly once. Given an acknowledgement larger than `unacked`, `unacked` is 0. Given a session that is killed while paused, it is resumed before it is killed. (Unit tests in core, on a fake PTY.)
- **AC2 – Renderer acknowledgement batching:** Given the renderer's acknowledgement batcher, when 4,999 parsed characters for session `1` are reported, then nothing is sent; when 1 more is reported, then exactly one `ack('1', 5000)` is sent; characters of session `2` are counted separately; a discarded chunk of 7,000 characters is acknowledged at once as `ack(id, 7000)` (plus whatever was pending). Given a session that ended, its pending count is gone. (Unit tests in core with a fake `TerminalApi` and fake screens, covering a main pane, an extra pane, an early chunk replayed on adoption and a chunk for an unknown session.)
- **AC3 – `terminal:ack` is guarded:** Given session `S` owned by the window, when the page sends `terminal:ack` with `S` and `0`, `-5`, `1.5`, `'100'`, `NaN` or `Infinity`, or with a session id that isn't the window's, then main's flow-control state for `S` is unchanged. (Unit test of the guard in core.)
- **AC4 – A stalled renderer doesn't build a backlog:** Given `api` running `yes drovr-flow | cat -n`, when the renderer's main thread is blocked for 3 s (a busy loop in `page.evaluate`) and then released, then after the user presses `Ctrl+C` and types `echo flow-done` and Enter, `flow-done` appears on `api`'s screen within 3 s of the Enter, and the line numbers on the screen keep increasing without a gap before the `^C` (no output was dropped: two consecutive visible numbered lines differ by 1).
- **AC5 – A paused card still stops:** Given `api` running `yes drovr-flow` with the renderer blocked for 2 s, when the user Closes `api` from the header and confirms (#7), then within 3 s `api` reads `Stopped` and its shell process has ended. Given a second card `web` streaming `yes`, when the user deletes it from its menu and confirms, then its shell process ends within 3 s.
- **AC6 – Normal use unchanged:** Given `api` open, when the user runs `seq 1 200000; sleep 30` (the `sleep` keeps the prompt from becoming the last line), then the last visible output line is `200000` and `api`'s status line on the board reads `Running` with last line `200000` after Back; the existing smoke tests (`npm run test:smoke`) pass unchanged.
- **AC7 – Firehose benchmark:** When `xvfb-run -a env BENCH_PROFILE=firehose npm run benchmark` runs, then the test passes with 0 dropped echoes, 10/10 sessions producing output and 10/10 status lines live, main lag p99 ≤ 100 ms, and the results table shows the most characters unacknowledged in main for any session (expected ≤ about 100,000 plus one PTY chunk). When `xvfb-run -a npm run benchmark` (sustained) runs, it still meets the full D8 budget. Both tables go in the PR's verification section next to #1's numbers.
- **AC8 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Flow control end to end:** a plain core module with the D2 constants and the per-session flow-control state (count sent, acknowledge with clamping, pause above high, resume below low, resume-before-kill, forget on exit), unit-tested on a fake PTY; `SessionManager` gains pause/resume and resumes before kill and `killAll`; main counts each `terminal:data` chunk it sends and handles `terminal:ack` with the D3 guard (a core guard function next to `isWriteData`, unit-tested); preload and `src/shared/api.ts` expose `terminal.ack`. In the renderer, a plain core acknowledgement batcher (D2, D4) used by `SessionRouter`: chunks routed to a card's main pane and to extra panes are acknowledged from the screen's write callback (`CardPanes`' output gains the callback `CardSessions` already uses), early chunks once replayed and parsed, discarded or unrouted chunks at once, pending counts dropped on exit and release; unit tests with fake screens. Main and renderer land in the same commit so no session can stall on missing acknowledgements. Satisfies AC1, AC2, AC3.
2. **S2 – End-to-end behaviour:** new `e2e/flow-control.spec.ts`: a stalled renderer, stopping and deleting paused cards, ordinary output unchanged; fix whatever it shows. Satisfies AC4, AC5, AC6.
3. **S3 – Benchmark and docs:** `e2e/benchmark.spec.ts` asserts per D7 (full budget for `sustained`, the reduced set for `firehose`) and reports the most unacknowledged characters per session (read from main through `app.evaluate` on a test-only accessor the flow-control module exposes, or a counter main keeps on `globalThis` only when `DROVR_BENCH` is set); run both profiles and record the numbers for the PR. `AGENTS.md`'s smoke-test list names `e2e/flow-control.spec.ts` and the benchmark line says what firehose asserts; `docs/specs/1-start-drovr` is not edited. Satisfies AC7, AC8.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (flow-control state, fake PTY) | n/a: core logic |
| AC2 | unit (ack batcher, router with fake screens) | n/a: core logic |
| AC3 | unit (ack guard) | n/a: core logic |
| AC4 | e2e `flow-control.spec.ts` | Run `yes … \| cat -n` in `api`; block the renderer 3 s; Ctrl+C, `echo flow-done`; time until it shows; check consecutive line numbers |
| AC5 | e2e `flow-control.spec.ts` | Stream `yes`; block the renderer; Close and confirm; poll status and the shell's pid; delete a streaming card from its menu |
| AC6 | e2e + existing smoke | `seq 1 200000`; read last line and the board's status line |
| AC7 | `npm run benchmark` both profiles under xvfb | Read `test-results/benchmark-firehose.md` and `benchmark-sustained.md` |
| AC8 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer can re-run `npm run benchmark` (both profiles) on the macOS beta.

## Stack changes

None: node-pty's own `pause`/`resume` and xterm.js's write callback; no new dependency or service.

## Data and migrations

None. `drovr-state.json` and `drovr-settings.json` are unchanged.

## Out of scope

- A renderer-side scheduler that limits how much parsing background cards get per frame (would be needed for fps ≥ 30 under firehose); a follow-up idea if the numbers call for it.
- Main-side batching or coalescing of output chunks.
- Any UI for paused or throttled terminals; a setting for the watermarks.
- Changing the D8 budget for the `sustained` profile.

## Open questions

None.
