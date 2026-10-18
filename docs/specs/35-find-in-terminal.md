---
item: 35
type: feature
title: 'Find in terminal (Mod+F)'
status: draft
branch: claude/35-find-in-terminal
---

# Find in terminal (Mod+F)

## Problem

Agents produce long output, and finding an error or a file name in a card's scrollback today means scrolling for it. After this ships, the Find shortcut in a card's (or shell's) full-size view opens a find bar on the focused pane that searches its screen and scrollback as you type, highlights every match, counts them, steps through them with Enter and Shift+Enter, and has Case sensitive and Regex toggles. The shortcut is rebindable in Settings' Shortcuts section like the others.

## Domain decisions

- **D1 – Engine:** every terminal screen (a card's main pane, every extra pane, every shell's panes) loads `@xterm/addon-search` (0.16.0, the release matching `@xterm/xterm` 6.0.0) when the screen is created; the bar drives it. Matches are found in the whole buffer: scrollback and screen. *Why:* the official addon of the xterm.js the app already uses; writing our own search over the buffer would duplicate it.
- **D2 – Shortcut:** a new configurable action `find`, labelled **Find** in Settings, default `Cmd+F` on macOS and `Ctrl+Shift+F` elsewhere, listed in Settings' Shortcuts section with the others (recording, refusals and Reset as #31 D8). Off macOS `Ctrl+F` stays the shell's (readline's forward-char), as `Ctrl+Shift+…` is the pattern of every other default there. Like every configurable shortcut, the terminal never sees any part of it (#31 D7), and a held key's auto-repeat does nothing more. It acts only in a card's or shell's full-size view, not on the board, and not while a dialog is open over the view. A settings file that already gave another action the new default (e.g. `splitRight: "Cmd+F"`) follows #31 D9's rule for two actions sharing a shortcut: both fall back to their defaults. *Why:* the developer picked Cmd+F / Ctrl+Shift+F; reusing the keymap gives rebinding for free.
- **D3 – One bar per open view, on the pane it searches:** the bar sits in the top-right corner of the pane it searches, left of an extra pane's close button so it never covers it. Find opens it on the focused pane. Find pressed while it is open on another pane (because another pane was focused by a click or by closing a pane) moves it to the focused pane, keeping the query and toggles, and searches there; the old pane's highlights are cleared. Find pressed while it is open on the focused pane focuses the query field and selects its text. Clicking another pane leaves the bar where it is. *Why:* the developer's choice; one bar keeps the view uncluttered with up to 4 panes.
- **D4 – The bar:** a text field (placeholder `Find`), the result text, a Previous match and a Next match button, a **Case sensitive** toggle (`Aa`) and a **Regex** toggle (`.*`), and a Close button (`X`), each button with its name as `aria-label` and tooltip; toggles show their state with `aria-pressed`. Both toggles start off.
- **D5 – Searching as you type:** every change of the query or a toggle searches again at once. The search starts from the newest output: the active match is the last match in the buffer, or, while typing extends a query whose active match still matches, that same match (the addon's incremental search). The active match is scrolled into view. An empty query clears every highlight and shows no result text.
- **D6 – Stepping:** Enter or the Next match button goes to the next match **upwards** (older output), Shift+Enter or the Previous match button **downwards** (newer output); both wrap around the ends of the buffer. *Why:* the search starts at the newest output (D5), so "next" means further back, as in VS Code's terminal; the developer chose Enter/Shift+Enter with wrapping.
- **D7 – Result text:** `<n> of <m>`, where `m` is the number of matches in the buffer and `n` the active match's position counted from the top (so the newest match reads `m of m`); `No results` when the query matches nothing; `Invalid regex` when Regex is on and the query isn't a valid JavaScript regular expression (then nothing is searched, the old highlights are cleared and the buttons are disabled); `More than 1,000` when there are more matches than the addon counts (its highlight limit, 1,000; `n` isn't known then). Previous and Next are disabled with no matches or an invalid regex. The text updates as new output arrives while the bar is open (the addon re-counts on each parse).
- **D8 – Highlights:** every match is outlined in amber (`#D19A00` border) and the active match is filled with it (`#D19A00` background, plus the border), on top of the terminal's own colours, so it reads on dark and light terminal themes alike; both show in xterm's overview ruler where present. The active match is also the terminal's selection, as the addon makes it.
- **D9 – Never the clipboard:** a selection Find makes never goes to the clipboard, even with **Copy on select** on; a selection the user makes with the mouse while the bar is open still does. *Why:* copy on select copies on every selection change, and the addon selects the active match.
- **D10 – Closing:** Escape in the bar or its Close button closes it, clears the highlights and the selection Find made, and gives keyboard focus back to the searched pane's terminal. The bar also closes, with nothing else changing, when the view goes away (Back, the card stopping, switching workspace or card) or when the pane it searches closes; reopening a card's view never brings it back on its own. Keys typed in the bar never reach a terminal; the view's other shortcuts (Back, splits, Close pane, Close card, Toggle panel, Find) still work while it has focus.
- **D11 – Remembered for the run of the app:** the last query and both toggles are remembered app-wide (one value for every card, shell and pane) until the app quits, never saved to a file. Opening the bar fills in the remembered query, selected, with the remembered toggles, and searches it at once (D5). *Why:* the developer's choice; searching the same error across several agents' cards is the common case.
- **D12 – Running or not:** the bar works on any pane whose screen exists, including an extra pane whose `ssh` failed (its screen is kept, #25). It does nothing in a view with no screen.

## Acceptance criteria

- **AC1 – Open and find:** Given a running plain card whose terminal printed `alpha` on 3 separate lines (e.g. `printf 'alpha\nbeta\nalpha\nalpha\n'`) and is open at full size, when the user presses Ctrl+Shift+F (Cmd+F on macOS) and types `alpha`, then a find bar shows in the top-right of the pane with focus in its field, the result text reads `3 of 3`, the terminal's selection is the `alpha` on the last of those lines, and the shell received none of the keys (no `alpha` typed at its prompt).
- **AC2 – Stepping and wrapping:** Given AC1's bar at `3 of 3`, when the user presses Enter, then it reads `2 of 3`; Enter twice more reads `1 of 3` then `3 of 3` (wrapped); Shift+Enter then reads `1 of 3` (wrapped downwards); the Next match and Previous match buttons do the same as Enter and Shift+Enter.
- **AC3 – No results, empty query:** Given the bar open, when the query is `zzz-none`, then it reads `No results` and Next and Previous are disabled; when the query is emptied, then no result text shows and the terminal has no search highlights.
- **AC4 – Case sensitive:** Given output `Error` and `error` on separate lines, when the query is `error` with Case sensitive off, then it reads `2 of 2`; when Case sensitive is turned on, then it reads `1 of 1` and the toggle has `aria-pressed="true"`.
- **AC5 – Regex:** Given output `file1.ts` and `file22.ts`, when Regex is on and the query is `file\d+\.ts`, then it reads `2 of 2`; with Regex off the same query reads `No results`; with Regex on and the query `file(`, it reads `Invalid regex` and Next and Previous are disabled.
- **AC6 – Highlights:** Given AC1's bar at `3 of 3`, then the terminal shows 3 match decorations, one of them the active one; when the bar closes, then none remain and the terminal has no selection.
- **AC7 – Escape and focus:** Given the bar open with a query, when the user presses Escape, then the bar is gone, and typing `echo ok` and Enter runs in the pane's shell (focus is back in the terminal).
- **AC8 – Clipboard untouched:** Given Copy on select on and the clipboard holding `before`, when the user finds `alpha` and steps with Enter, then the clipboard still holds `before`.
- **AC9 – Remembered query:** Given the user found `alpha` with Case sensitive on and closed the bar, when they open Find again in the same card or in another card, then the field holds `alpha`, selected, Case sensitive is on, and the result text is already shown for that card's output; after the app restarts, opening Find shows an empty field with both toggles off.
- **AC10 – Live count:** Given the bar open on `alpha` reading `3 of 3`, when the pane's shell prints `alpha` once more, then the result text shows 4 matches.
- **AC11 – Split panes:** Given a card split right into 2 panes, the extra pane focused and having printed `gamma`, when the user presses Find and types `gamma`, then the bar is in the extra pane and reads `1 of 1`; when the user clicks the main pane and presses Find, then the bar moves to the main pane with `gamma` still in its field, reading `No results` (assuming the main pane never printed `gamma`), and the extra pane has no highlights; the extra pane's close button is never covered by the bar.
- **AC12 – Closes with its pane and view:** Given the bar open on an extra pane, when that pane is closed (its close button or Close pane), then the bar is gone; given the bar open on the main pane, when the user presses Back and opens the card again, then no bar shows; given the bar open, when the card's shell exits (`exit`), then the view goes back to the board and, opened again, shows no bar.
- **AC13 – Shells:** Given a workspace's Default shell open at full size, when the user presses Find and types a word it printed, then the bar finds it as in AC1.
- **AC14 – Only in the full-size view:** Given the board with no card open, when the user presses Find, then nothing opens and nothing changes; given the Settings dialog open over a card's view, when the user presses Find, then no bar opens.
- **AC15 – Rebinding:** Given Settings' Shortcuts section, then it lists **Find** with `Ctrl+Shift+F` (`Cmd+F` on macOS); when the user records `Ctrl+Alt+F` for it, then Ctrl+Alt+F opens the bar in a card's view and Ctrl+Shift+F no longer does (it reaches the shell), and the setting survives a restart; recording a fixed shortcut (e.g. `Ctrl+Shift+C`) is refused with `Already used by Copy`, and Reset brings back the default.
- **AC16 – Keymap rules:** Given a settings file whose `shortcuts` has `"splitRight": "<Find's default on this OS>"`, when the app reads it, then both Split right and Find take their defaults (#31 D9), as for any two actions sharing a shortcut.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Find in a card's main pane:** the `find` action in the keymap (defaults, label, Settings listing comes from the action list), the search addon on every screen with the search, step, clear and result-change hooks the bar needs and the copy-on-select guard (D9), the find bar in the full-size view on the focused pane (D4–D8, D10), the app-wide remembered query and toggles (D11), closing on Back and on stop. Unit tests for the keymap additions (defaults on both OSes, label, `readShortcuts` sharing, refusals) and for any pure helpers (result text from count, index and regex validity). E2E in a new `e2e/find.spec.ts`. Satisfies AC1–AC10, AC12 (Back and stop parts), AC14, AC15, AC16.
2. **S2 – Panes and shells:** the bar following Find to the focused pane (D3), closing with its pane, not covering the close button, and working in a shell's view. E2E in `e2e/find.spec.ts`. Satisfies AC11, AC12 (pane part), AC13.

Docs: `AGENTS.md`'s smoke test list names `e2e/find.spec.ts` and what it covers; `CONTEXT.md`'s **Settings** entry lists Find among the shortcuts; the stack description in `.factory/stack.json` (and `docs/agents/stack.md`, regenerated) names the search addon beside fit, webgl and web-links.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | e2e `find.spec.ts` (result text, terminal selection via `__xterm.getSelection()`, the shell's buffer) | open a plain card, print `alpha` 3 times, press Find, type, Enter/Shift+Enter, read the bar |
| AC3, AC4, AC5 | e2e; unit for the result text helper | type the queries, toggle, read the bar and the buttons' `disabled` |
| AC6 | e2e (count `.xterm-decoration-container` children or the addon's decorations; none after close) | look at the highlighted matches, close, look again |
| AC7 | e2e | Escape, type `echo ok`, read the buffer |
| AC8 | e2e (main's clipboard read through the existing test hooks in `terminal.spec.ts`) | turn on Copy on select, write `before`, find, read the clipboard |
| AC9 | e2e (two cards, then a restart through `launch.ts`) | close and reopen in another card; restart |
| AC10 | e2e | print once more, read the count |
| AC11, AC12 | e2e | split, find, click, Find, close pane, Back, `exit` |
| AC13 | e2e | open the Default shell, find |
| AC14 | e2e | press Find on the board and with Settings open |
| AC15 | e2e (`settings.spec.ts` style recorder helpers) | Settings > Shortcuts, record, use, restart, Reset |
| AC16 | unit (`keymap.test.ts`) | — |

## Stack changes

None. `@xterm/addon-search` is an addon of the xterm.js already in the stack (as fit, webgl and web-links are), added to `package.json` dependencies; the stack's description text gains "search" in its addon list, no option changes.

## Data and migrations

`drovr-settings.json`'s `shortcuts` may hold a `find` entry, written only when it differs from the default (#31 D9). Existing files need nothing: a file without it gets the default. The remembered query and toggles are never saved.

## Out of scope

- Whole word matching (the developer picked only Case sensitive and Regex).
- Searching every pane, every card or a workspace at once.
- Find on the board's card previews.
- Saving the query across restarts; a search history.
- Replacing text, or acting on matches beyond selecting the active one.

## Open questions

None.
