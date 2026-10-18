---
item: 40
type: feature
title: 'Command palette and quick card switcher'
status: approved
branch: claude/40-command-palette
---

# Command palette and quick card switcher

## Problem

With many workspaces and cards, reaching a card means switching workspace, then finding it on the board; Mod+digit only covers the first nine workspaces, and actions are spread over menus and shortcuts. After this ships, one shortcut (Cmd+K on macOS, Ctrl+Shift+P elsewhere) opens a palette that fuzzy-finds any card or shell in any workspace by title, workspace, branch or status and opens it in one step, and runs any of the app's existing actions with its shortcut shown. Renderer only: no new IPC, no saved data beyond the shortcut.

## Domain decisions

- **D1 – Shortcut:** a new configurable action `palette`, labelled **Command palette** in Settings' Shortcuts section, default `Cmd+K` on macOS and `Ctrl+Shift+P` elsewhere, recorded, refused and Reset like the others (#31 D8). Like every configurable shortcut the terminal never sees it (#31 D7, the terminal's key filter already lets keymap actions through) and a held key's auto-repeat does nothing more. It works anywhere in the window (board, card or shell view, empty state) unless a dialog other than the palette is open (`[aria-modal="true"]`). A settings file giving another action the new default follows #31 D9 (both fall back). *Why:* full auto chose the existing keymap over a fixed Mod+K: off macOS Ctrl+K is readline's kill-line, which users type in every shell; Ctrl+Shift+P is VS Code's palette key and free in Drovr.
- **D2 – The palette:** a modal dialog (the app's `Modal`, `aria-label="Command palette"`), near the top of the window and centred, with a search field (placeholder `Search cards, shells and actions`) focused and empty on every open, and below it one list of rows in up to three sections, in this order: **Cards**, **Shells**, **Actions**; a section with no rows is not shown. With no matching row at all it shows `No matches`. The list scrolls; the selected row is kept in view. *Why:* full auto chose one list for both jobs over a `>` prefix or two palettes.
- **D3 – Card and shell rows:** every card of every workspace, and every shell of every workspace (its Default shell included, named `Default shell`). A row shows the title, then in a dimmer line its workspace's name, the card's worktree branch when it has one, and its status label (`Running`, `Stopped`, `SSH failed: …`, `Couldn't start`) followed by its activity pill text when it has one (`Working`, `Waiting for you`, `Needs your answer`). Status and activity follow live changes while the palette is open. A row's searchable text is its title, workspace name, worktree branch, status label and activity text. *Why:* the item asks for title, branch and agent status; the workspace name tells same-titled cards in different repos apart.
- **D4 – Matching:** a pure function in `src/core` (no dependency, no DOM): the query, trimmed, is split on spaces into terms; a row matches when every term is a case-insensitive subsequence of its searchable text (D3; for an action, its label). A row's score is the sum of each term's best score, ranked: the term is a prefix of the title or label (best) > it starts at a word start in the searchable text > it occurs contiguously > scattered. Within a section rows are sorted by score, ties keeping D5's order. The sections themselves keep D2's order whatever the scores. *Why:* full auto chose a small own matcher, unit-testable in Vitest, over a library (a stack change) or plain substring (no fuzzy).
- **D5 – Order with an empty query:** Cards: the active workspace's cards first, then each other workspace's in sidebar order; inside a workspace, column by column left to right, top to bottom. Shells: the same workspace order, the Default shell first, then named shells in their strip order. Actions: in D6's order. *Why:* deterministic, needs no new state; a most-recently-used order is left for later.
- **D6 – Actions:** existing actions only, each offered only when it would do something now, each row showing its shortcut on the right when it has one (as D7 text from the current keymap, `Mod+<n>` as `Cmd+<n>` / `Ctrl+<n>` for a workspace), in this order:
  1. With a card or shell open at full size: **Back to board**; **Split right** and **Split down** (while it runs with fewer than 4 panes, #11 D4); **Close pane** (an extra pane is focused); **Close card** (while it runs; opens the Close confirmation, #7); **Toggle panel**; **Find** (opens the find bar on the focused pane, #35); and for a card (not a shell) **Move card to <column>** for every other column of its workspace (to the column's bottom, as the card menu's move, #6 D8; the card stays open).
  2. Always, with an active workspace: **New card** (D9); **Open Default shell**.
  3. Always: **New workspace** (the workspace dialog); **Open Settings**; **Theme: System**, **Theme: Dark**, **Theme: Light** (except the current theme); **Switch to workspace <name>** for every workspace but the active one, in sidebar order (the first nine show their Mod+digit).
  Running an action does exactly what its shortcut, button or menu item does today. *Why:* full auto chose applicable-only rows over disabled ones, so every row does something.
- **D7 – Opening a card or shell:** picking a card or shell row opens it at full size in its workspace, starting it first when it isn't running, exactly as clicking it on its board or in the shell strip; one in another workspace first makes that workspace active (the same path a clicked notification takes, #31). Picking the card that is already open just closes the palette. *Why:* one step from anywhere to the terminal is the point of the item.
- **D8 – Keyboard and closing:** Up and Down move the selection, wrapping at both ends; the first row is selected whenever the list changes; the mouse selects a row on hover and runs it on click. Enter runs the selected row (nothing with no rows). Running a row closes the palette first. Escape, a click outside, or the palette shortcut pressed again closes it with nothing run; focus then goes back to where it was (a terminal's pane keeps its keyboard). Keys typed in the palette never reach a terminal. The palette isn't opened over another dialog (D1), and other configurable shortcuts and Mod+digit do nothing while it is open (it is a dialog).
- **D9 – New card:** goes to the active workspace's board (Back first when a card or shell is open) and opens the New card form of the board's first column, focused, exactly as its `New card` button does. *Why:* reuses the existing form; no new UI.
- **D10 – Nothing saved:** the palette keeps no query, selection or history, across opens or restarts. Only the shortcut, when changed, is saved (in `drovr-settings.json`'s `shortcuts`, #31 D9).

## Acceptance criteria

- **AC1 – Open and close:** Given a workspace on its board, when the user presses Ctrl+Shift+P (Cmd+K on macOS), then a dialog `Command palette` shows with its search field focused and empty; pressing Escape closes it; pressing the shortcut opens it and pressing it again closes it; with the Settings dialog open the shortcut opens nothing.
- **AC2 – From a terminal:** Given a running plain card open at full size with focus in its terminal, when the user presses the shortcut, types `xyz` in the palette and presses Escape, then the palette closed, the shell received none of those keys (no `P` or `xyz` at its prompt) and typing `echo ok` Enter runs in the card's shell.
- **AC3 – Jump to a card in another workspace:** Given workspaces `Alpha` (active, with card `build`) and `Beta` (card `deploy api`, Stopped), when the user opens the palette, types `dep`, and presses Enter, then `Beta` is the active workspace, `deploy api` is open at full size and Running.
- **AC4 – Rows, order and sections:** Given `Alpha` active with cards `one` and `two` in Backlog and `Beta` with card `three`, when the palette opens with an empty query, then the Cards section lists `one`, `two`, `three` in that order, each with its workspace name and `Stopped`; the Shells section lists `Default shell` for `Alpha` then for `Beta`; the Actions section follows.
- **AC5 – Fuzzy and multi-term matching:** Given cards `fix login bug` and `refactor billing` in `Alpha`, when the query is `flb`, then only `fix login bug` is listed under Cards; when it is `alpha bill`, then only `refactor billing`; when it is `qqq`, then `No matches` shows.
- **AC6 – Branch and activity:** Given a worktree card on branch `drovr/search-index` and a running card whose agent ran `board activity . question`, when the query is `search-index`, then the worktree card is listed with its branch shown; when the query is `needs`, then the running card is listed showing `Needs your answer`.
- **AC7 – Context actions:** Given a running card open at full size in a workspace with columns Backlog, In Progress, Review, Done and the card in Backlog, when the palette opens, then Actions lists Back to board, Split right, Split down, Close card, Toggle panel, Find, Move card to In Progress, Move card to Review, Move card to Done, and not Close pane nor Move card to Backlog; each of Back to board, Split right and Find shows the same shortcut as Settings' Shortcuts section; on the board none of these rows is listed.
- **AC8 – Actions run:** Given AC7, when the user runs Split right from the palette, then the card shows 2 panes; when they run Move card to Review, then after Back to board the card is in Review; when they run Close card, the Close confirmation shows.
- **AC9 – App actions:** Given the board, when the user runs Theme: Dark, then the app is dark and the settings file has `"theme": "dark"`, and Theme: Dark is no longer listed; when they run Open Settings, the Settings dialog opens; when they run Switch to workspace Beta, Beta is active and the row showed `Ctrl+2` (`Cmd+2` on macOS) when Beta is second in the sidebar.
- **AC10 – New card:** Given a card open at full size, when the user runs New card, then the board of the active workspace shows with the first column's New card form open and its title field focused.
- **AC11 – Keyboard selection:** Given 3 listed rows with the first selected, when the user presses Up, then the last row is selected; Down then selects the first again; Enter runs it.
- **AC12 – Rebinding:** Given Settings' Shortcuts section, when the user records `Ctrl+Alt+K` for Command palette, then that opens the palette and Ctrl+Shift+P no longer does (the settings file holds `"palette": "Ctrl+Alt+K"`); Reset brings the default back.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Matcher and rows:** the pure matching and ordering in `src/core` (D3–D6's row model built from the workspace state, the open view and the current keymap, D4 scoring), unit-tested; no UI. Satisfies the logic behind AC4, AC5, AC6, AC7 (unit level).
2. **S2 – Palette with card and shell switching:** the `palette` keymap action (defaults, label, Settings row), the palette dialog opened from App with card and shell rows only, keyboard and closing (D1, D2, D3, D7, D8, D10). Satisfies AC1, AC2, AC3, AC4, AC5, AC6, AC11, AC12.
3. **S3 – Actions:** the Actions section and running each action through the existing paths: card view actions (Back, splits, Close pane, Close card, Toggle panel, Find, Move card) through the same handlers its shortcuts use, plus New card, Open Default shell, New workspace, Open Settings, themes, workspace switching (D6, D9). Satisfies AC7, AC8, AC9, AC10.
4. **S4 – Docs:** AGENTS.md's smoke-test list names `e2e/palette.spec.ts`; CONTEXT.md gains **Command palette**; Settings in CONTEXT.md lists the new shortcut.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | e2e `e2e/palette.spec.ts` | Open with the shortcut on the board and from a focused terminal, Escape, toggle, Settings open blocks it |
| AC3 | e2e | Two workspaces, Stopped card in the other, type, Enter, check active workspace and card view Running |
| AC4, AC5, AC6 | Vitest (`src/core` matcher) + e2e | Rows and order in the dialog; worktree card from #38's setup helpers, `board activity` from the card |
| AC7, AC8 | Vitest (applicability) + e2e | Open a running card, list Actions, run Split right, Move card, Close card |
| AC9, AC10 | e2e | Run theme, Settings, workspace switch, New card rows |
| AC11 | e2e | Up/Down wrap, Enter |
| AC12 | e2e + Vitest (`keymap` defaults) | Record in Settings, settings file entry, Reset |

## Stack changes

None.

## Data and migrations

`drovr-settings.json`'s `shortcuts` may hold a `palette` entry (only when it differs from the default, #31 D9). Existing files are unchanged; an older Drovr reading a `palette` entry ignores it as an unknown key.

## Out of scope

- Most-recently-used ordering or any history of picks.
- Searching terminal output or files from the palette.
- New actions that don't exist today (rename, delete, restart from the palette).
- Columns, workspace editing or deleting from the palette.

## Open questions

None.

## Decided by full auto

Round 1: one configurable shortcut (Cmd+K / Ctrl+Shift+P); one list with Cards, Shells, Actions; card rows match title, workspace, worktree branch, status and activity; own subsequence matcher in `src/core`; empty-query order active workspace first then sidebar order; applicable-only actions with shortcuts; picking a card in another workspace switches and opens it; Up/Down wrap, Enter, Escape/outside/shortcut close; New card opens the first column's form.
