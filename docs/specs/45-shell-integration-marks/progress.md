# Progress #45 Shell integration: prompt marks and command status

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f44a4cd..ebf0951` | CLEAN | `src/core/shell-marks.ts`: `parseShellMark`, `ShellMarks<Line>` (`feed`, `commands()`, `prompts()`, `directory()`, `onCommandEnded`, `forget`), `ShellDirectory {host?, path}`; `XtermScreen.marks: ShellMarks<MarkLine>`, `MarkLine = IMarker \| undefined`, times `Date.now()` |
| S2 | done | `01d4b45..e91f176` | fixed r1 | `shellIntegrationStart(shell, {enabled, scriptsDir, env, command?}) → {args, env}` (`src/core/shell-integration.ts`); `SpawnOptions.args`; Preference `shellIntegration`, main `MainSettings.shellIntegration()`; `shellIntegrationDir()` in main terminals; switch test id `settings-shell-integration`. fish 4 emits its own 133 marks: prompts on the same row count once |
| S3 | done | `caecf9a..ec92f83` | CLEAN | actions `previousPrompt`/`nextPrompt`; `promptJumpTarget` (`src/core/prompt-jumps.ts`); `XtermScreen.jumpToPrompt`; `ShellMarks.feed` drops undefined rows (listeners still fire) |
| S4 | done | `2cfc2db..5171a48` | ruling r1 | `longCommandNotice` (`src/core/long-commands.ts`); `CardPanes` createScreen `(cardId, paneId)`; `onScreenCreated` in card-terminals; `DrovrApi.longCommandMs` (dev-only `DROVR_LONG_COMMAND_MS`) |
| S5 | running | | | |

## Rulings

- 2026-10-19: full auto approved the spec (no stack change).

- 2026-10-19 S4: Notifications switch hint → adds "and when a command that ran 10 s or more ends out of sight" (full auto, round 2).

## Verification

- todo
