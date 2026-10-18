---
item: 32
type: chore
title: 'Drag and drop workspaces'
status: approved
branch: claude/32-drag-drop-workspaces
---

# Drag and drop workspaces

## Problem

Workspaces sit in the sidebar in the order they were created, so the repository the user works in most can't be put at the top. After this ships the user drags a workspace to another place in the sidebar, or moves it with the keyboard, and the new order is kept: across a restart, through the sync folder, and for Mod+digit switching (the first workspace is Mod+1).

The order already lives in the saved state (`drovr-state.json`) and the sync file (`drovr-board.json`) as the order of the workspace list, so this only adds the move.

## Domain decisions

- **D1 – Move rule:** `moveWorkspace(workspaceId, toIndex)` in the workspace store puts the workspace at `toIndex` among the other workspaces (0 = top, counted without it); an index past the end means the bottom, negative or fractional indexes round as `moveCard` does. Moving to the same place succeeds and changes nothing (no save). An unknown workspace fails with the existing unknown-workspace error. *Why:* one store operation serves drag and keyboard, mirroring #6 D3 for cards.
- **D2 – Moving touches nothing else:** a move changes only the order. The active workspace, every workspace's name, directory, host, columns, cards and shells, every running terminal and each workspace's remembered view are unchanged. *Why:* the item asks only for arrangement; a running card must never notice (`docs/product.md`).
- **D3 – Kept and synced:** the order is the workspace list's order, so it is saved with the board like any other change, and with a sync folder it is written to the sync file and reaches other machines like any other change (last writer wins, #13 D7). No new field. *Why:* the order is already part of both files.
- **D4 – Drag:** native HTML5 drag and drop, as cards do (#6 D5), no new dependency. A workspace row in the sidebar can be dragged, expanded or collapsed. While dragging, the dragged row is dimmed and a horizontal line shows where it would land: above a row when the pointer is in its top half, below it in its bottom half. Releasing over the workspace list moves it there; Esc, or releasing outside the list, cancels and nothing changes. A drag never selects a workspace. Only workspace drags are accepted by the list (a card dragged over it shows no line and drops nothing), and a column accepts no workspace. *Why:* the item asks for drag and drop; Playwright drives it and Esc cancel comes with it.
- **D5 – Keyboard:** with a workspace row focused, Alt+Up and Alt+Down move it one place up or down; at the top or bottom the key does nothing. The moved row keeps focus. Plain arrows and Enter behave as before. *Why:* keyboard support is a board rule (#2 D12); the same keys move cards (#6 D7).
- **D6 – Mod+digit follows the order:** Mod+1…9 switch to the workspace in that place in the sidebar as it now reads. *Why:* the shortcut already reads the list order.
- **D7 – Security boundaries unchanged:** the board model lives in the renderer; no new IPC. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md.

## Acceptance criteria

Workspaces `alpha`, `beta`, `gamma` exist, created in that order, each on an existing directory, with `alpha` active, unless stated otherwise.

- **AC1 – Store:** `moveWorkspace` moves up, down, to the top, to the bottom, past the end; the same place leaves the state object unchanged; an unknown id fails; the active id and every workspace's contents are unchanged (unit).
- **AC2 – Drag to the top:** when the user drags `gamma` onto the top half of `alpha`, then the sidebar reads `gamma`, `alpha`, `beta`, `alpha` is still the active workspace and its board is still shown.
- **AC3 – Drag down:** when the user drags `alpha` onto the bottom half of `gamma`, the sidebar reads `beta`, `gamma`, `alpha`.
- **AC4 – Cancel:** when the user starts dragging `gamma` and presses Esc or releases it outside the sidebar, the order is unchanged and `alpha` is still active.
- **AC5 – Running card unaffected:** given a running card in `beta` with output `drovr-marker`, when `beta` is dragged to the top, then switching to `beta` shows the card `Running` with `drovr-marker`.
- **AC6 – Keyboard:** with `beta`'s row focused, Alt+Up gives `beta`, `alpha`, `gamma` with focus on `beta`'s row; Alt+Up again changes nothing; Alt+Down twice gives `alpha`, `gamma`, `beta`; `alpha` stays active throughout.
- **AC7 – Mod+digit:** after `gamma` is moved to the top, Mod+1 switches to `gamma`.
- **AC8 – Kept across a restart:** after `gamma` is moved to the top and the app restarts, the sidebar reads `gamma`, `alpha`, `beta`.
- **AC9 – Synced:** with two instances sharing a sync folder, moving `gamma` to the top on one makes the other's sidebar read `gamma`, `alpha`, `beta`.
- **AC10 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

1. **S1 – Move workspaces:** `moveWorkspace` in the workspace store (D1, D2) with Vitest tests; a pure drop-index helper for the sidebar (top/bottom half of a row, below the last row, dragging within the list) with Vitest tests; draggable workspace rows with the drop line, dimmed source, Esc and outside-drop cancel and no select on drag (D4), its own drag type so cards and workspaces never cross; Alt+Up/Down on a focused row (D5). Smoke tests in `e2e/board.spec.ts` (drag, cancel, keyboard, running card, Mod+digit), `e2e/persistence.spec.ts` (restart) and `e2e/sync.spec.ts` (two instances). Update `AGENTS.md`'s smoke test list. Satisfies AC1–AC10.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (store) | — |
| AC2, AC3 | unit (drop index) + e2e | Drag a row onto another row's top/bottom half; read the sidebar names and the active row |
| AC4 | e2e | Start a drag, Esc / release outside; order and active row unchanged |
| AC5 | e2e | Run `printf drovr-marker; sleep 30` in a `beta` card, drag `beta` to the top, switch to it, read the card |
| AC6 | e2e | Focus a row, press Alt+arrows, read order, focused element and active row |
| AC7 | e2e | Move `gamma` to the top, press Mod+1, read the active row |
| AC8 | e2e | Move, restart with the same data directory, read the sidebar |
| AC9 | e2e | Two instances on one sync folder; move on one, read the other |
| AC10 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | Both green |

## Stack changes

None.

## Data and migrations

None: the order of `workspaces` in `drovr-state.json` and the sync file already is the sidebar's order.

## Out of scope

- Dragging cards onto a workspace to move them between workspaces.
- A "Move up/down" menu (workspace rows have no menu).
- Sorting workspaces automatically (by name, by use).

## Open questions

None.
