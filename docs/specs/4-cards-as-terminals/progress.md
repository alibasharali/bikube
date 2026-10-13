# Progress #4 Cards as terminals

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Cards in the workspace model | done | `d3536d9..2952789` | CLEAN | workspace-store.ts: `Card {id,columnId,title,directory}`; `Workspace.cards: Card[]` (oldest first), `nextCardNumber`; ErrorField +'title'\|'card'; store `createCard(wsId,colId,title): Result<Card>`, `renameCard(wsId,cardId,title)` (blank -> 'Title is required'), `deleteCard(wsId,cardId)`; `cardsInColumn(ws,colId)`; deleteColumn with cards -> {field:'column',message:'Delete its cards first'} (last-column error wins). card-status.ts: `stripEscapes`, `lastOutputLine(lines, cursorRow)`, `CardRunState = running \| exited{exitCode,signal?} \| failed{reason}`, `statusLabel(state)`, `cardStatus(state,lastLine): {label,lastLine}` |
| S2 Spawn in a directory | done | `cd8b711..c42585c` | HUMAN finding (reload race) resolved by orchestrator as technical, option (a); fixed r1, r2 | `SpawnResult = {ok:true,id} \| {ok:false,reason}`; `window.drovr.terminal.spawn(cols, rows, cwd): Promise<SpawnResult>`; reasons: 'invalid terminal size', 'invalid working directory', 'working directory not found', 'window reloaded', spawn error message or 'the shell could not be started'; show as `Couldn't start: <reason>`. Terminal.tsx unused (cwd prop), replace in S3 |
| S3 Card terminals, creation, full-size view | done | `d7cd7ab..7181375` | CLEAN | core `CardSessions` (src/core/card-sessions.ts): `start({id,directory})`, `screen(id)`, `status(id)`, `runState(id): CardRunState`, `subscribe(id,fn)` (250 ms), `dispose(id)` (kills if running; safe while spawn pending). Renderer `cardTerminals()` singleton (src/renderer/src/card-terminals.ts), `useCardStatus(id)`, `XtermScreen.attach(el)`. Components CardItem, CardView, CardStatusLine, NewCard; BoardColumn takes `workspace`, `onOpenCard`; InlineInput `cancelOnBlur`. Testids: new-card, new-card-input, card (li, data-card-id), card-open, card-title, card-status(-label/-line), card-view, card-view-title, card-back, card-terminal, terminal. Card menu goes as a sibling of card-open in the li. e2e/cards.spec.ts. Note: Ctrl/Cmd+Shift+B capture listener also fires under an open Modal |
| S4 Card menu, deletes, confirmations | running | | | |
| S5 Benchmark on cards | todo | | | |

## Rulings

- 2026-10-13 S2: reviewer flagged a reload race (spawn awaiting the directory check could orphan a shell after reload, against D16) as HUMAN with two technical fixes. Not a domain decision (both keep D16 as written), so the orchestrator chose (a) per-page generation tokens; flagged in the PR for the developer.

## Verification

- todo
