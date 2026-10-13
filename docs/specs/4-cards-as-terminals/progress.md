# Progress #4 Cards as terminals

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Cards in the workspace model | done | `d3536d9..2952789` | CLEAN | workspace-store.ts: `Card {id,columnId,title,directory}`; `Workspace.cards: Card[]` (oldest first), `nextCardNumber`; ErrorField +'title'\|'card'; store `createCard(wsId,colId,title): Result<Card>`, `renameCard(wsId,cardId,title)` (blank -> 'Title is required'), `deleteCard(wsId,cardId)`; `cardsInColumn(ws,colId)`; deleteColumn with cards -> {field:'column',message:'Delete its cards first'} (last-column error wins). card-status.ts: `stripEscapes`, `lastOutputLine(lines, cursorRow)`, `CardRunState = running \| exited{exitCode,signal?} \| failed{reason}`, `statusLabel(state)`, `cardStatus(state,lastLine): {label,lastLine}` |
| S2 Spawn in a directory | done | `cd8b711..c42585c` | HUMAN finding (reload race) resolved by orchestrator as technical, option (a); fixed r1, r2 | `SpawnResult = {ok:true,id} \| {ok:false,reason}`; `window.drovr.terminal.spawn(cols, rows, cwd): Promise<SpawnResult>`; reasons: 'invalid terminal size', 'invalid working directory', 'working directory not found', 'window reloaded', spawn error message or 'the shell could not be started'; show as `Couldn't start: <reason>`. Terminal.tsx unused (cwd prop), replace in S3 |
| S3 Card terminals, creation, full-size view | running | | | |
| S4 Card menu, deletes, confirmations | todo | | | |
| S5 Benchmark on cards | todo | | | |

## Rulings

- 2026-10-13 S2: reviewer flagged a reload race (spawn awaiting the directory check could orphan a shell after reload, against D16) as HUMAN with two technical fixes. Not a domain decision (both keep D16 as written), so the orchestrator chose (a) per-page generation tokens; flagged in the PR for the developer.

## Verification

- todo
