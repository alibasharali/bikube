# Progress #60 Select a command's output (shell integration marks)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `41a6b63..10c3597` | CLEAN | `ShellMarks.feed(mark,time,line,column?)`, `ShellMarks.outputs()`; `src/core/command-output.ts`: `endedOutputs(outputs,row)`, `outputRange`, `rangeLength(range,cols)`, `chooseCommandOutput(commands,{top,rows,bottom,cols},hasOutput)`; XtermScreen feeds `cursorX` |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

None yet.

## Verification

- todo
