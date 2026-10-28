---
item: 57
type: bug
title: 'Files not showing up on the workspace itself'
status: approved
branch: claude/57-files-on-board
---

# Files on the workspace's board

## Problem

The side panel (#55) with its Files tab shows only while a card or shell is open at full size; on a workspace's board there is no panel, no title-bar button and the Toggle panel shortcut does nothing, so the workspace's files can't be seen without opening a card. #55 left "the panel on the board" out of scope; this item adds it. Builds on #55's `SidePanel`, `FilesTab`, the `sidePanelOpen`/`sidePanelWidth` preferences and the Toggle panel shortcut.

## Domain decisions

- **D1 – Panel beside the board:** while a workspace's board shows, the side panel sits at the right of the board, full height of the content area, as it does beside a card (#55 D1): same tabs, hide button and resize edge (changed after shipping, developer's request 2026-10-28: from the window's top, with its tabs and show/hide button in the title bar above it as #55 D1 now says, and the workspace toolbar above the board ending at its edge). The board shrinks to fit and keeps scrolling horizontally. Not on the empty state (no workspace).
- **D2 – Which folder:** on the board the Files tab shows the workspace's folder, as the Default shell does (#55 D5); an SSH workspace reads `Files aren't available over SSH yet` (#55 D6). Expansion and Changed only are shared with that folder's cards and shells (they are kept per folder shown).
- **D3 – One open state:** the board uses the same saved `sidePanelOpen` and `sidePanelWidth` as cards (#55 D3): hiding it on the board hides it in cards, and the reverse.
- **D4 – Toggling on the board:** the title bar's panel button shows on the board too (whenever a workspace is active), and the Toggle panel shortcut and the command palette's `Toggle panel` row work on the board, as in a card: the shortcut is swallowed on auto-repeat and does nothing behind a dialog.
- **D5 – Nothing else changes:** cards, drags, the board's columns and saved state behave as before.

## Acceptance criteria

A local workspace `repo` on a git repository with committed `README.md` and `src/a.ts`, a fresh data directory, the board showing.

- **AC1 – Shown on the board:** when `repo` is created and its board shows, then the side panel shows at the right of the board, 280 px wide, with the Files tab whose root row reads `repo` and lists `src` and `README.md`; the title bar's panel button is pressed.
- **AC2 – Toggle on the board:** when the user presses `Ctrl+Alt+B` on the board, the panel hides, the button is unpressed and `drovr-settings.json` holds `"sidePanelOpen": false`; opening a card then shows no panel; the button shows it again. The palette's `Toggle panel` row on the board toggles it too.
- **AC3 – SSH:** given an SSH workspace's board, the panel shows and reads `Files aren't available over SSH yet`.
- **AC4 – Checks:** `.claude/check.sh` and the smoke tests of the side panel, palette and board pass.

## Slices

1. **S1 – Panel on the board:** the panel beside the board, the title bar button on the board, the shortcut and palette row handled by the app for the board and cards alike, palette core offering Toggle panel on the board, e2e in `e2e/side-panel.spec.ts`. Satisfies AC1–AC4.

## Stack changes

None.

## Out of scope

- Per-view panel state (board versus card) and any new tab.
- Files over SSH.
