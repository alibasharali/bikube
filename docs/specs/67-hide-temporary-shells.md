---
item: 67
type: chore
title: New terminals should not show up in “shells” pane
status: approved
branch: claude/67-hide-temporary-shells
---

# New terminals should not show up in “shells” pane

## Problem

A shell opened with New shell (Cmd+T / Ctrl+Shift+T, #66) while the Default shell runs is a temporary `Terminal N`, and today it is listed in the side panel's Shells tab beside the workspace's saved shells. The Shells tab is for the Default shell and the shells the user created and saved to run again. After this ships, temporary shells show only in the sidebar tree under their workspace (and the palette), never in the Shells tab.

## Domain decisions

- **D1 – The Shells tab lists saved shells only:** the Default shell and the workspace's named shells that are not temporary (#66 D2). Temporary shells are left out of its rows, its running count on the tab, and the title bar's running-shells chip that opens it while the panel is hidden. *Why:* the item; the sidebar tree, the palette and the full-size view already reach them.
- **D2 – Everything else about temporary shells is unchanged:** named `Terminal N`, opened at full size, listed in the sidebar tree and the palette, removed when they stop, never saved (#66 D2, D3). Closing one is done from its open view (Close card shortcut, `exit`).

## Acceptance criteria

- **AC1 – Not in the Shells tab:** Given the Default shell is running, when the user presses New shell, then `Terminal 1` opens running and is listed in the sidebar tree under the workspace, and the Shells tab lists only `Default` (one row); its running count reads 1.
- **AC2 – Saved shells still listed:** Given a named shell `Later` is added and `Terminal 1` runs, then the Shells tab lists `Default` and `Later` only.

## Slices

1. **S1 – Shells tab without temporary shells:** a core helper giving the workspace's listed shells (Default first, then named non-temporary shells), used by the Shells tab's rows and its running count; the Shells tab rows' temporary-only branches go; e2e in `e2e/shells.spec.ts` updated to find temporary shells in the sidebar tree. Satisfies AC1, AC2.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest on the helper; e2e `e2e/shells.spec.ts` | Press New shell twice: `Terminal 1` in the sidebar tree, Shells tab shows only Default |
| AC2 | Vitest; e2e `e2e/shells.spec.ts` | Add `Later` with a temporary shell running: Shells tab shows Default and Later |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- A "keep this shell" action that saves a temporary shell.
- Any change to the sidebar tree or the palette.

## Open questions

None.
