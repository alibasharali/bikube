# Progress #16 Terminal output flow control (backpressure)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `015287a..4d96961` | CLEAN | `src/core/flow-control.ts` (HIGH_WATERMARK, LOW_WATERMARK, ACK_BATCH_CHARS, FlowControl with sent/acknowledged/kill/forget/unacked(id)); main's FlowControl instance is local to registerTerminals (S3 must expose it for the benchmark); `src/core/ack-batcher.ts` AckBatcher; IPC.ack=`terminal:ack`, `window.drovr.terminal.ack(id, chars)`; `isAckChars`; SessionManager.pause/resume; SessionRoute.output(data, parsed) |
| S2 | done | `c982c1b..406ab7a` | CLEAN | `e2e/flow-control.spec.ts` (AC4–AC6); must be named in AGENTS.md smoke list (S3) |
| S3 | done | `08767bf..a4f9237` | CLEAN | FlowControl.peakUnacked/resetPeak; `globalThis.__drovrFlowPeak` in main when DROVR_BENCH is set |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-14 spec: round 1 answered by full auto with the recommendations (ack-based, VS Code thresholds, firehose budget per D7, no UI).

## Verification

- done (ALL PASS, firehose re-run by verifier: 0 dropped, peak 118,803)

Benchmark, Linux under xvfb, DOM renderer (S3 run). Sustained: fps 60.0, echo max 4.9 ms, 0 dropped, main lag p99 4.4 ms, 10/10 live, peak unacked 7,170: all PASS. Firehose: fps 31.7 (was 8.4 in #1), echo p50/max 100.1/137.5 ms, 0 dropped echoes (was 16/20), main lag p99 3.3 ms, 10/10 live, peak unacked 119,262 (high watermark 100,000). Status-line poll in the benchmark samples every 100 ms (firehose shows a cut-off line most of the time).
