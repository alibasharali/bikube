# Progress #35 Find in terminal (Mod+F)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `a722b2a..c33868e` | fixed r1 | `XtermScreen.find(q)`, `findStep(q, 'up'\|'down')`, `clearFind()`, `onFindResults(l)→unsub` (`FindQuery {query, caseSensitive, regex}`); CardView state `find: {paneId, request} \| null`, `Pane` renders `<FindBar screen focusRequest onClose besideClose>` for the matching id; `findStore` in `src/renderer/src/find.ts`; `findResultText`, `isValidRegex`, `FIND_HIGHLIGHT_LIMIT` in `src/core/find.ts`. Left for S2: `find` keeps a closed pane's id. |
| S2 | todo | | | |

## Rulings

- 2026-10-18 grilling round 1 answered by full auto (see the item); spec self-approved under full auto (no stack change).
- 2026-10-18 S1 (full auto): review found D5's incremental path broader than the spec (backspace, toggles kept the active match) → keep D5 as written: only an extending query with unchanged toggles keeps the match. `More than 1,000` only when the count exceeds 1,000.

## Verification

- todo
