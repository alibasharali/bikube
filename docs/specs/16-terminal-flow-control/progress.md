# Progress #16 Terminal output flow control (backpressure)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `015287a..4d96961` | CLEAN | `src/core/flow-control.ts` (HIGH_WATERMARK, LOW_WATERMARK, ACK_BATCH_CHARS, FlowControl with sent/acknowledged/kill/forget/unacked(id)); main's FlowControl instance is local to registerTerminals (S3 must expose it for the benchmark); `src/core/ack-batcher.ts` AckBatcher; IPC.ack=`terminal:ack`, `window.drovr.terminal.ack(id, chars)`; `isAckChars`; SessionManager.pause/resume; SessionRoute.output(data, parsed) |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-14 spec: round 1 answered by full auto with the recommendations (ack-based, VS Code thresholds, firehose budget per D7, no UI).

## Verification

- todo
