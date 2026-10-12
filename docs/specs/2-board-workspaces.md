---
item: 2
type: feature
title: The Board and Workspaces
status: draft
branch: claude/2-board-workspaces
---

# The Board and Workspaces

## Problem

Drovr's spike opens one window with a terminal grid and no structure. A developer running agents across several repos needs a workspace per repo (a name and a working directory) and a kanban-style board in each. After this ships the app opens to a sidebar of workspaces and a professional, intuitive board with editable columns; cards, drag and drop and persistence come in later items.

## Domain decisions

- **D1 – Scope:** workspaces plus a board with user-editable columns (add, rename, reorder, delete). No cards yet. *Why:* developer choice (Q1).
- **D2 – Workspace:** has an id, a name and a working directory (absolute path). It is "basically a new board": each workspace owns exactly one board. The working directory is what every terminal in that workspace will start in (used by the cards item; this item only stores it). *Why:* item description.
- **D3 – Default columns:** a new workspace's board starts with Backlog, Running, Needs me, Done (from `docs/product.md`), all editable. *Why:* product direction.
- **D4 – In memory only:** workspaces and columns live in memory and are lost on quit. Persistence is its own item. *Why:* developer choice (Q2). Store logic is plain TS in `src/core` with an in-memory implementation behind a small interface so persistence can slot in.
- **D5 – Switching:** a left sidebar lists workspaces with a + button; the active one is highlighted; the sidebar can be collapsed to a narrow rail and expanded again. The first workspace created becomes active; selecting another switches the board. *Why:* developer choice (Q3: recommendation, collapsible).
- **D6 – Create/edit dialog:** fields Name and Working directory. The directory has an editable path field plus a "Browse…" button opening the native folder picker (main process, via a typed preload API). Choosing a folder fills the path and, while Name is untouched/empty, defaults Name to the folder's basename. The same dialog edits an existing workspace (rename and change directory). *Why:* developer choices (Q4, Q5).
- **D7 – Validation:** name is trimmed, non-empty and unique among workspaces (case-insensitive); the directory must exist and be a directory (checked by main via an `fs` bridge call). Errors show inline under the field and block saving. Changing the directory of a workspace to one that is invalid is rejected the same way. *Why:* Q5; a terminal can't start in a missing directory.
- **D8 – Delete:** deleting a workspace asks for confirmation naming it ("removes its board") and then removes it. If it was active, the first remaining workspace becomes active, or the empty state shows. *Why:* Q5.
- **D9 – First launch:** with no workspaces the main area shows an empty state with an explanation and a prominent "Create workspace" button. *Why:* Q6.
- **D10 – Columns:** names are trimmed, non-empty and unique within the board (case-insensitive). Add appends at the end via an inline "Add column" affordance; rename inline (double-click or menu); reorder with "Move left/right" in the column menu (drag and drop is a later item); delete from the menu, no confirmation while there are no cards. A board must keep at least one column (delete disabled on the last one). *Why:* Q1; drag and drop is out of scope; cards don't exist yet so deletion loses nothing.
- **D11 – Spike UI removed:** the toolbar and terminal grid in `App.tsx` go; the board replaces them. `src/core` spike modules, the terminal IPC and `Terminal.tsx` stay for the cards item. Smoke tests that targeted the spike UI are updated to the board (window opens, workspace creation, a column rename). *Why:* developer choice (Q7).
- **D12 – Look and feel:** a restrained dark-neutral theme with one accent colour, consistent spacing scale, readable column headers with card counts (0 for now), keyboard support (Enter submits, Esc cancels dialogs/inline edits, focus visible, dialog traps focus), and macOS-style window chrome padding when `platform === 'darwin'`. *Why:* item description asks for professional and intuitive.
- **D13 – Security boundaries unchanged:** contextIsolation on, nodeIntegration off, sandbox on. New IPC (`dialog:pickDirectory`, `fs:isDirectory`) is validated in `src/core/ipc-guards` style (string argument checks). *Why:* AGENTS.md.

## Acceptance criteria

- **AC1 – Empty state:** Given a fresh launch, when the window opens, then no workspace is listed and the main area shows "Create workspace" as a button.
- **AC2 – Create:** Given the create dialog, when the user picks (or types) `/tmp/alpha` (existing directory) with Name empty, then Name defaults to `alpha`; on Create the sidebar lists `alpha` highlighted and the board shows columns Backlog, Running, Needs me, Done in that order.
- **AC3 – Validation:** Given workspace `alpha` exists, when the user submits Name `Alpha` (or empty/whitespace) or a directory that doesn't exist or is a file, then an inline error appears and no workspace is created.
- **AC4 – Switch:** Given workspaces `alpha` and `beta`, when `beta` is clicked, then `beta` is highlighted and its own board shows; edits to `alpha`'s columns are not visible on `beta`.
- **AC5 – Edit:** Given `alpha`, when the user renames it to `gamma` and changes its directory to another existing directory, then the sidebar shows `gamma` and its stored working directory is the new one; a duplicate name is rejected as in AC3.
- **AC6 – Delete:** Given active workspace `alpha` and `beta`, when the user deletes `alpha` and confirms, then `alpha` disappears and `beta` becomes active; cancelling the confirmation changes nothing; deleting the last workspace shows the empty state.
- **AC7 – Columns:** Given a board, when the user adds `Review`, renames `Running` to `Doing`, moves `Done` left, and deletes `Needs me`, then the columns read Backlog, Doing, Done, Review; duplicate or empty names are rejected; the last remaining column cannot be deleted.
- **AC8 – Sidebar collapse:** Given the sidebar expanded, when the user collapses it, then only a narrow rail remains with the active workspace still reachable, and expanding restores the list.
- **AC9 – Keyboard:** Given any dialog or inline edit, when Esc is pressed, then it cancels; when Enter is pressed in a valid form, it submits.
- **AC10 – Spike UI gone, checks green:** Given the change, then the old toolbar and "1 terminal" counter no longer render, and `.claude/check.sh` plus `npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Workspace store and validation (core):** pure TS workspace/board model in `src/core`: create, update, delete, select, uniqueness and name defaulting, default columns, column add/rename/move/delete rules, with Vitest unit tests. Satisfies AC2 (logic), AC3 (name rules), AC5, AC6 (logic), AC7 (logic).
2. **S2 – Directory bridge:** typed `window.drovr.fs.isDirectory` and `dialog.pickDirectory` (shared api, preload, main handlers with guards and unit-tested guard/validation). Satisfies AC3 (directory rules), D13.
3. **S3 – Shell, sidebar and empty state:** replace `App.tsx` with the layout, theme, collapsible sidebar, workspace list, empty state. Satisfies AC1, AC4, AC8, AC10 (UI part).
4. **S4 – Workspace dialog and delete:** create/edit dialog with Browse, defaults, inline errors, delete confirmation, keyboard handling. Satisfies AC2, AC3, AC5, AC6, AC9.
5. **S5 – Board columns UI:** board view with column headers, count, add/rename/move/delete menus, inline editing. Satisfies AC7, AC9.
6. **S6 – Smoke tests and cleanup:** update Playwright-Electron tests to the new UI, remove dead spike UI code and CSS. Satisfies AC10.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e smoke | Launch; assert empty state and button |
| AC2, AC3 | unit (core store), e2e smoke with a temp directory | Create via dialog with typed path; try duplicate, missing path |
| AC4 | unit + e2e | Create two workspaces, click each, edit columns on one |
| AC5, AC6 | unit + e2e | Edit and delete flows incl. cancel |
| AC7 | unit (core) + e2e | Run the column sequence, read header order |
| AC8, AC9 | e2e (component-level where possible) | Collapse/expand; Esc and Enter in dialog |
| AC10 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | Screenshot the board under xvfb |

The native folder picker can't be driven headlessly; e2e types the path, and the Browse button is checked by the developer on macOS.

## Stack changes

None.

## Data and migrations

None. State is in memory (D4).

## Out of scope

- Cards, terminals on the board, drag and drop, persistence, workspace reordering, per-column colours or WIP limits.
- Using the working directory when spawning terminals (cards item).

## Open questions

- deferred: whether the sidebar collapsed state should persist (comes with the persistence item).
