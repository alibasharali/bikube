# Progress #4 Cards as terminals

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Cards in the workspace model | done | `d3536d9..2952789` | CLEAN | workspace-store.ts: `Card {id,columnId,title,directory}`; `Workspace.cards: Card[]` (oldest first), `nextCardNumber`; ErrorField +'title'\|'card'; store `createCard(wsId,colId,title): Result<Card>`, `renameCard(wsId,cardId,title)` (blank -> 'Title is required'), `deleteCard(wsId,cardId)`; `cardsInColumn(ws,colId)`; deleteColumn with cards -> {field:'column',message:'Delete its cards first'} (last-column error wins). card-status.ts: `stripEscapes`, `lastOutputLine(lines, cursorRow)`, `CardRunState = running \| exited{exitCode,signal?} \| failed{reason}`, `statusLabel(state)`, `cardStatus(state,lastLine): {label,lastLine}` |
| S2 Spawn in a directory | running | | | |
| S3 Card terminals, creation, full-size view | todo | | | |
| S4 Card menu, deletes, confirmations | todo | | | |
| S5 Benchmark on cards | todo | | | |

## Rulings

None yet.

## Verification

- todo
