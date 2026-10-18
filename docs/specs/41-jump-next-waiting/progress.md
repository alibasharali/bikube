# Progress #41 Jump to the next card that needs you

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b6f0b0f..0d0307c` | CLEAN | `waiting.ts`: nextWaiting(queue, openId), withActivity, isWaiting, waitingCounts, withoutDeleted; `attention.ts`: waitingQueue(), subscribeWaiting(l), useWaitingQueue(); testids workspace-waiting, workspace-waiting-dot |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

- 2026-10-18 S1: activity pills differ in colour (waiting green, question amber) → the count uses the question pill's amber (spec D6 corrected).

## Verification

- todo
