# Progress #60 Select a command's output (shell integration marks)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `41a6b63..10c3597` | CLEAN | `ShellMarks.feed(mark,time,line,column?)`, `ShellMarks.outputs()`; `src/core/command-output.ts`: `endedOutputs(outputs,row)`, `outputRange`, `rangeLength(range,cols)`, `chooseCommandOutput(commands,{top,rows,bottom,cols},hasOutput)`; XtermScreen feeds `cursorX` |
| S2 | done | `8b6d16e..b946bfe` | fixed r1 (e2e records clipboard writes) | action `copyCommandOutput` (keymap `SHORTCUT_ACTIONS`, label `Copy command output`, `CardViewAction`); `XtermScreen.copyCommandOutput()`; `textRange` in command-output.ts; App.tsx already routes card-view ids to `runCardViewAction`; e2e helper `recordClipboardWrites()` |
| S3 | running | | | |

## Rulings

None yet.

## Verification

- todo
