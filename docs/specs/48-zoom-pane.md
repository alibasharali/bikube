---
item: 48
type: feature
title: Zoom a pane
status: draft
branch: claude/48-zoom-pane
---

# Zoom a pane

## Problem

A card (or a workspace shell) can be split into up to 4 panes (#11), and then each pane is small. Other terminals solve this with a zoom: tmux `prefix z`, Ghostty `toggle_split_zoom`, iTerm2 "maximize pane". After this ships, a **Zoom pane** shortcut fills the open view with its focused pane, and pressing it again brings the split layout back as it was. The other panes keep running, hidden. Broadcasting input to every pane, the item's optional second half, is dropped (D9).

## Domain decisions

- **D1 – Zoom is part of the layout:** a view's `PaneLayout` (#11) gets an optional `zoomed` flag. While it is set, the view shows only the focused pane, filling the whole pane area; the split tree itself is unchanged, so unzooming shows exactly the layout from before. A layout with one pane is never zoomed: zooming it does nothing. Like the rest of the layout, the core functions return a new object on every change and the same object when nothing changes. *Why:* the layout is already the per-view state the view renders, remembers and resets, so zoom gets all of that for free.
- **D2 – Hidden panes keep running:** the panes not shown stay mounted, their shells running and their output parsed (flow control acknowledges it as before, #16); they are only hidden. A hidden pane keeps its terminal size (a screen is not fitted while it has no width), and is fitted again when the zoom ends.
- **D3 – The shortcut:** a new configurable action `zoomPane`, labelled **Zoom pane** in Settings' Shortcuts and the palette, defaults to `Shift+Cmd+Enter` on macOS and `Ctrl+Shift+Enter` elsewhere (Ghostty's and iTerm2's keys). It toggles the zoom of the open view's focused pane. Like the other card view actions it runs through the shared card view actions, works from a focused terminal (the shell receives none of its keys), does nothing behind a dialog, and can be recorded and reset in Settings. *Why not* `Shift+Cmd+Z`: redo in editors.
- **D4 – What ends a zoom:** the shortcut again; clicking the zoom chip (D5); splitting (the zoom ends, then the focused pane is split as usual, tmux's behaviour); closing the zoomed pane (its close button or Close pane; the remaining panes show and focus moves as #11 D5 says); the main shell stopping (the layout resets to the main pane, #11 D6). Find, Back and the side panel don't end it.
- **D5 – The zoom chip:** while zoomed, the shown pane has a small button in its top-left corner reading `Zoomed · N panes` (N is the view's pane count, e.g. `Zoomed · 3 panes`), with the title `Show all panes`. Clicking it ends the zoom and gives the keyboard back to the pane's terminal. It stays clear of the find bar and an extra pane's close button, which are at the top right. *Why:* the open card has no bar (#31), so without a sign the hidden panes would look lost.
- **D6 – Remembered with the view:** leaving a card with Back or by switching workspace and coming back shows it still zoomed, as panes are remembered within a run (#11, #31). Nothing about panes survives a restart, so neither does zoom. Nothing is written to the state, settings or sync files.
- **D7 – The palette:** the open view's actions include a **Zoom pane** row (with the shortcut) whenever the view has more than one pane or is zoomed. Picking it does what the shortcut does.
- **D8 – Workspace shells too:** a workspace's shells (the Default shell and named shells) split like cards, so they zoom the same way.
- **D9 – Broadcast input dropped:** typing into every pane at once is not built, and `docs/product.md`'s Dropped list records it. *Why:* the item rates it low value, and keys sent to several agents at once are more likely a mistake than a wish in Drovr's use.

## Acceptance criteria

- **AC1 – Zoom and restore:** Given an open running card split into 3 panes (main, right, and the right one split down) with the bottom-right pane focused, when the user presses Zoom pane (`Ctrl+Shift+Enter` on Linux) with the focus in its terminal, then only that pane is visible, filling the pane area, its terminal is wider than before, the shell received no input, and the chip reads `Zoomed · 3 panes`. When they press it again, all 3 panes show in the same arrangement, the same pane focused.
- **AC2 – Hidden panes keep running:** Given a zoomed card with a command in a hidden pane printing a line every 200 ms, when the zoom ends, then that pane shows the lines printed while it was hidden.
- **AC3 – Ends of a zoom:** Given a zoomed card, clicking the chip shows all panes; splitting right ends the zoom and adds a fourth pane, focused, to the right of the zoomed one; closing the zoomed extra pane with Close pane shows the remaining 2 panes; typing `exit` in the main pane's shell resets the view to a stopped card with no chip.
- **AC4 – Single pane:** Given an open card with one pane, when the user presses Zoom pane, then nothing changes and no chip shows; the palette has no Zoom pane row.
- **AC5 – Remembered:** Given a zoomed card, when the user goes Back to the board and opens it again, then it is still zoomed with the same pane shown.
- **AC6 – Palette and Settings:** Given a split card open, the palette lists `Zoom pane` with its shortcut, and picking it zooms. In Settings' Shortcuts, Zoom pane shows the default, can be recorded to another key that then zooms, and Reset brings back the default.
- **AC7 – Shell view:** Given the workspace's Default shell split into 2 panes, Zoom pane zooms its focused pane and restores it.
- **AC8 – Layout rules (Vitest, `split-tree`):** zooming a 1-pane layout returns the same object; zooming then unzooming a split layout gives back an equal tree and focus; splitting a zoomed layout returns an unzoomed layout with the new pane; removing the focused pane of a zoomed layout returns it unzoomed; removing a hidden pane keeps the zoom when more than one pane remains, and ends it when only one remains.
- **AC9 – Keymap (Vitest, `keymap`):** `zoomPane` defaults to `Shift+Cmd+Enter` on darwin and `Ctrl+Shift+Enter` elsewhere, a saved keymap without it reads the default, and it is refused as a duplicate like any other action.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Zoom end to end:** the `zoomed` flag and its rules in the split tree; `CardPanes` toggling it; the `zoomPane` shortcut action with defaults and its Settings label; the card view action, hiding the other panes and the chip; the palette row; e2e tests for AC1–AC7 in `e2e/panes.spec.ts` (AC6's Settings part in `e2e/settings.spec.ts`, AC7 in `e2e/shells.spec.ts` if simpler); AGENTS.md's test list names them. Satisfies AC1–AC9.
2. **S2 – Product note:** `docs/product.md`'s Dropped list gains broadcast input (D9). Satisfies D9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `e2e/panes.spec.ts` | split 3 panes, focus one, press the shortcut, check visibility, width, chip; press again |
| AC2 | e2e `e2e/panes.spec.ts` | run a printing loop in a pane, zoom another, unzoom, read the pane |
| AC3 | e2e `e2e/panes.spec.ts` | chip click, split, Close pane, `exit` while zoomed |
| AC4 | e2e `e2e/panes.spec.ts` | one-pane card: shortcut, palette |
| AC5 | e2e `e2e/panes.spec.ts` | zoom, Back, reopen |
| AC6 | e2e `e2e/palette.spec.ts` / `e2e/settings.spec.ts` | palette row; record, use, Reset |
| AC7 | e2e `e2e/shells.spec.ts` | Default shell split, zoom, restore |
| AC8 | Vitest `src/core/split-tree.test.ts` | — |
| AC9 | Vitest `src/core/keymap.test.ts` | — |

## Stack changes

None.

## Data and migrations

None: zoom is runtime only. The settings file's `shortcuts` may now hold a `zoomPane` entry; an older file without it reads the default.

## Out of scope

- Broadcast input to several panes (D9).
- Resizing panes or moving focus between panes by keyboard.
- Zoom on the board's terminal previews.

## Open questions

None.
