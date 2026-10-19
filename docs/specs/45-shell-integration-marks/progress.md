# Progress #45 Shell integration: prompt marks and command status

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f44a4cd..ebf0951` | CLEAN | `src/core/shell-marks.ts`: `parseShellMark`, `ShellMarks<Line>` (`feed`, `commands()`, `prompts()`, `directory()`, `onCommandEnded`, `forget`), `ShellDirectory {host?, path}`; `XtermScreen.marks: ShellMarks<MarkLine>`, `MarkLine = IMarker \| undefined`, times `Date.now()` |
| S2 | running | | | |
| S3 | todo | | | |
| S4 | todo | | | |
| S5 | todo | | | |

## Rulings

- 2026-10-19: full auto approved the spec (no stack change).

## Verification

- todo
