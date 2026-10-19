# Progress #42 Move cards automatically on activity

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `724b6c3..3ee3000` | CLEAN | `src/core/auto-move.ts`: `AUTO_MOVE_TRIGGERS`, `AutoMoveTrigger`, `AutoMove = Partial<Record<AutoMoveTrigger,string>>`, `keepKnownRules`, `rulesNameKnownColumns`, `readAutoMove`; `Workspace.autoMove?`; `WorkspacePatch.autoMove` replaces all (`{}` = off); dialog selects `workspace-auto-move-working/waiting/stopped`; `e2e/auto-move.spec.ts` exists, AGENTS.md entry to extend |
| S2 | done | `6f5e280..3d237ab` | CLEAN | `autoMoveTarget(workspace, card, event)`, `AutoMoveEvent`; renderer `startAutoMoves()`; IPC `app:quitting` (`window.drovr.app.onQuitting`) sent in before-quit (D4) |

## Rulings

- 2026-10-19: spec approved by full auto (round 1 answered with recommendations).

## Verification

- done: all 13 ACs pass
