# Progress #41 Jump to the next card that needs you

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b6f0b0f..0d0307c` | CLEAN | `waiting.ts`: nextWaiting(queue, openId), withActivity, isWaiting, waitingCounts, withoutDeleted; `attention.ts`: waitingQueue(), subscribeWaiting(l), useWaitingQueue(); testids workspace-waiting, workspace-waiting-dot |
| S2 | done | `643765e..a50bb1d` | CLEAN | keymap action `nextWaiting` (Settings testids settings-shortcut-nextWaiting); `waiting.ts` nextWaitingCard(queue, openId, workspaces); App `openNextWaiting.current()` for the palette |
| S3 | done | `e526c8d..eef0421` | CLEAN | palette action `nextWaiting`; PaletteInput.waiting |

## Rulings

- 2026-10-18 S1: activity pills differ in colour (waiting green, question amber) → the count uses the question pill's amber (spec D6 corrected).
- 2026-10-18 S2 (round 2, full auto): `board` refuses calls from shells, so no shell can wait → AC7 checked at unit level; shells stay in D1 (spec corrected).

## Verification

- todo
