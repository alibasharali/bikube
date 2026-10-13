---
item: 6
type: feature
title: Drag and drop cards
status: approved
branch: claude/6-drag-drop-cards
---

# Drag and drop cards

## Problem

Cards sit in the column they were created in, in creation order (#4 D1), so a column can't say what state the work is in and a column with cards can't be emptied without killing terminals. After this ships the user drags a card to another column or to another place in its column, or moves it with the keyboard or the card menu, and the card's terminal keeps running throughout.

## Domain decisions

- **D1 – Scope:** cards move between columns and within a column, on the board. Columns keep reordering with `Move left` / `Move right` in their menu (#2 D10); dragging columns is not part of this item. *Why:* Q1; the item and `docs/product.md` name cards.
- **D2 – Order:** a card's place is its column plus its position in that column. Creation still puts a new card at the bottom of its column (#4 D1); after that, only moves change the order. The workspace's card list keeps that order, so the column shows its cards top to bottom as stored. *Why:* reordering needs a stored order; one list keeps `cardsInColumn` as it is.
- **D3 – Move rule:** moving card C to column K at position i (0 = top, counted among K's cards without C) puts C there; i past the end means the bottom. Moving to the same place succeeds and changes nothing. Unknown workspace, card or column fails with the existing errors. *Why:* one store operation serves drag, keyboard and menu.
- **D4 – Moving never touches the terminal:** a move changes only the card's column and position. Its process, screen, scrollback, status, startup command, agent session id, title and directory are unchanged, whether it is running, Stopped or Couldn't start. *Why:* item description, `docs/product.md` ("Moving a card never stops its process").
- **D5 – Drag:** native HTML5 drag and drop, no new dependency. A card on the board can be dragged by its body (not while it is being renamed). While dragging, the card's place on the board is dimmed and a horizontal line shows where it would land. Releasing over a column moves it there; Esc, or releasing outside any column, cancels and nothing changes. Starting a drag never opens the card, and releasing does not open it either. *Why:* Q2; Playwright drives it and Esc cancel comes with it.
- **D6 – Drop position:** over a card, the line goes above it when the pointer is in the card's top half and below it in the bottom half; in the gap between two cards or just above the first one, the nearest card decides the same way. Over the column's header, its empty area (`No cards yet`), the space below the last card or the `+ New card` button, the card lands at the bottom. *Why:* Q4.
- **D7 – Keyboard:** with a card focused on the board, Alt+Up and Alt+Down move it one place up or down in its column; Alt+Left and Alt+Right move it to the bottom of the previous or next column. At an end (top, bottom, first or last column) the key does nothing. The moved card keeps focus. Plain arrows and Enter behave as before. *Why:* Q3; keyboard support is a board rule (#2 D12).
- **D8 – Menu:** the card menu gains a `Move to` group listing every other column of the board by name, in board order, between `Rename` and `Startup command…`; picking one moves the card to the bottom of that column and keeps focus on the card there. With only one column there is nothing to list and the group is absent. *Why:* Q3; discoverable and testable.
- **D9 – Column delete hint:** a column that has cards still can't be deleted; its hint becomes `Move or delete its cards first` (store error and menu hint). *Why:* Q5; moving out is now the way to empty a column without stopping terminals. Replaces #4 D14's wording.
- **D10 – Counts:** column card counts follow moves at once. *Why:* the header count is the column's state.
- **D11 – Open card unaffected:** the full-size view has no move controls; moving a card that another view shows changes nothing there. *Why:* moving happens on the board.
- **D12 – Security boundaries unchanged:** the board model lives in the renderer; no new IPC. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md.

## Acceptance criteria

Workspace `alpha` has an existing working directory and the default columns (Backlog, Running, Needs me, Done), unless stated otherwise.

- **AC1 – Drag to another column:** Given card `api` in `Backlog` where the user ran `export DROVR_X=7; printf 'drovr-marker'; sleep 30` (still running), when the user drags `api` onto the `Running` column, then `api` is in `Running`, `Backlog`'s count reads `0`, `Running`'s reads `1`, the card's status still reads `Running` and `drovr-marker`, and opening `api` shows the earlier output and, after Ctrl+C, `echo $DROVR_X` prints `7`.
- **AC2 – Reorder by drag:** Given cards `a`, `b`, `c` top to bottom in `Backlog`, when the user drags `c` onto the top half of `a`, then `Backlog` reads `c`, `a`, `b`; dragging `c` onto the bottom half of `b` gives `a`, `b`, `c`.
- **AC3 – Drop between columns at a position:** Given `x`, `y` in `Running` and `a` in `Backlog`, when the user drags `a` onto the bottom half of `x`, then `Running` reads `x`, `a`, `y` and `Backlog` is empty with `No cards yet`.
- **AC4 – Drop on empty column or header:** Given `a` in `Backlog` and `Done` empty, when the user drags `a` onto `Done`'s `No cards yet` area, then `a` is in `Done`; given `b` in `Backlog` and `a` in `Done`, dragging `b` onto `Done`'s header puts it below `a`.
- **AC5 – Cancel:** Given `a` in `Backlog`, when the user starts dragging `a` and presses Esc or releases it outside every column, then `a` is still first in `Backlog`, and no card opened.
- **AC6 – Click still opens:** Given a card that was just moved by drag, when the user clicks it, then it opens at full size.
- **AC7 – Keyboard:** Given `a`, `b` in `Backlog` with `b` focused, when the user presses Alt+Up, then `Backlog` reads `b`, `a` and `b` has focus; Alt+Up again changes nothing; Alt+Right moves `b` to the bottom of `Running` with focus on it; Alt+Left in `Backlog` changes nothing.
- **AC8 – Menu:** Given `a` in `Backlog` and `x` in `Done`, when the user opens `a`'s menu, then `Move to` lists `Running`, `Needs me`, `Done` in that order (not `Backlog`); picking `Done` puts `a` below `x` with focus on `a`.
- **AC9 – Stopped and failed cards move:** Given a Stopped card `s` and a Couldn't start card `f`, when each is moved to `Done`, then both keep their status there, and opening `s` starts it again with its startup command (#5 D7).
- **AC10 – Column delete hint:** Given `Backlog` holds a card, its column menu's Delete is disabled with hint `Move or delete its cards first`; after the card is moved to `Running`, deleting `Backlog` works.
- **AC11 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Move in the store:** `moveCard(workspace, card, column, index)` in the workspace store with the D3 rule, keeping each column's order in the one card list; the new column-delete wording (store error and `columnDeleteHint`). Vitest unit tests: within a column up and down, to another column at top/middle/bottom, index past the end, same place, unknown ids, other cards and other fields untouched. Satisfies AC2, AC3, AC10 (logic), D3, D4, D9.
2. **S2 – Keyboard and menu moves:** a pure helper computing the target of Alt+arrow moves (unit-tested: ends and neighbouring columns); Alt+arrow handling on a focused card with focus kept on it; the card menu's `Move to` group. Smoke tests in a new `e2e/moves.spec.ts`, including that a moved running card keeps its process and output and that Stopped and Couldn't start cards move. Satisfies AC1 (process kept), AC7, AC8, AC9, AC10.
3. **S3 – Drag and drop:** cards draggable; drop indicator per D6 with a pure helper for the drop index (unit-tested: top/bottom half, header, empty column, below the last card, dragging within the same column); dimmed source; Esc and outside-drop cancel; no open on drag. Smoke tests with Playwright drags. Update `AGENTS.md`'s smoke test list. Satisfies AC1, AC2, AC3, AC4, AC5, AC6, AC11.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | Create `api`, run the export/printf, drag to `Running`; read counts and status; reopen, `echo $DROVR_X` in the xterm buffer |
| AC2 | unit (store, drop index) + e2e | Drag onto top/bottom half of a card; read titles in `Backlog` |
| AC3 | unit + e2e | Drag across columns onto a card's bottom half |
| AC4 | unit (drop index) + e2e | Drag onto empty area and onto a column header |
| AC5 | e2e | Start a drag, Esc / release outside; order unchanged, no full-size view |
| AC6 | e2e | Click a moved card; full-size view opens |
| AC7 | unit (key target) + e2e | Focus card, press Alt+arrows, read order and focused element |
| AC8 | e2e | Open card menu, read `Move to` entries, pick `Done` |
| AC9 | e2e | Exit a card's shell (`exit`), and a card on a removed directory; move both; read statuses; open the Stopped one |
| AC10 | unit + e2e | Column menu Delete hint, then move the card out and delete |
| AC11 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | Both green |

HTML5 drag and drop needs a real pointer drag in Playwright (`dragTo` or mouse down/move/up with intermediate moves); the developer checks the feel of dragging on macOS.

## Stack changes

None.

## Data and migrations

The in-memory card list's order becomes meaningful within a column (D2); no new fields. Nothing persists yet, so nothing to migrate; the persistence item stores cards in this order.

## Out of scope

- Dragging columns; dragging cards between workspaces.
- Moving several cards at once.
- Moving cards from the agent command-line tool (`board move`), which is its own item.
- Persisting card positions across restarts (persistence item).
- Auto-scrolling the board while dragging near its edge.

## Open questions

None.
