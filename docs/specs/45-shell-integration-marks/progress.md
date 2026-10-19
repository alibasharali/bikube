# Progress #45 Shell integration: prompt marks and command status

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f44a4cd..ebf0951` | CLEAN | `src/core/shell-marks.ts`: `parseShellMark`, `ShellMarks<Line>` (`feed`, `commands()`, `prompts()`, `directory()`, `onCommandEnded`, `forget`), `ShellDirectory {host?, path}`; `XtermScreen.marks: ShellMarks<MarkLine>`, `MarkLine = IMarker \| undefined`, times `Date.now()` |
| S2 | done | `01d4b45..e91f176` | fixed r1 | `shellIntegrationStart(shell, {enabled, scriptsDir, env, command?}) → {args, env}` (`src/core/shell-integration.ts`); `SpawnOptions.args`; Preference `shellIntegration`, main `MainSettings.shellIntegration()`; `shellIntegrationDir()` in main terminals; switch test id `settings-shell-integration`. fish 4 emits its own 133 marks: prompts on the same row count once |
| S3 | done | `caecf9a..ec92f83` | CLEAN | actions `previousPrompt`/`nextPrompt`; `promptJumpTarget` (`src/core/prompt-jumps.ts`); `XtermScreen.jumpToPrompt`; `ShellMarks.feed` drops undefined rows (listeners still fire) |
| S4 | running | | | |
| S5 | todo | | | |

## Rulings

- 2026-10-19: full auto approved the spec (no stack change).

## Verification

- todo
