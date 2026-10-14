---
item: 11
type: feature
title: Split panes inside a card
status: draft
branch: claude/11-split-panes
---

# Split panes inside a card

## Problem

A card is one terminal. A developer running an agent in a card often wants a second shell next to it for the same work: a dev server, a test watcher, a quick `git status`. Today that means another card, which splits one piece of work across the board. The product lists "split panes inside a card" as the step after v1, which is merged (#2–#10). After this ships, a card's full-size view can be split into up to four panes, each a live shell in the card's directory; the card's own shell stays the one the board shows, and the extra panes live and die with it.

## Domain decisions

- **D1 – Panes:** a card's full-size view shows 1 to 4 **panes**. The **main pane** is the card's own terminal as today (its startup command, agent session id, status, Close). Every other pane is an **extra pane**: a plain login shell started in the card's directory, with no startup command typed into it (a second `claude --resume` on the same agent session id would clash). A card that isn't running has no extra panes. *Why:* round 1 Q1, Q3.
- **D2 – Splitting:** the full-size view's header gets `Split right` and `Split down` buttons, shown only while the card is running, both disabled while the card has 4 panes. Splitting divides the **focused** pane into two equal halves: `Split right` puts the new pane to its right, `Split down` below it. Splits nest (a pane that is already a half can be split again, in either direction), forming a tree; every split is 50/50 and there are no draggable dividers. The new extra pane starts its shell at once and gets the focus. *Why:* round 1 Q2, Q4.
- **D3 – Focus:** exactly one pane is focused: the main pane when the view first opens for a start, the new pane after a split, a pane the user clicks, and the main pane again after the focused extra pane goes away. The focused pane has keyboard focus and an accent outline (`data-focused="true"`). Leaving the view (Back) and opening it again keeps the layout and which pane is focused. *Why:* splits act on "the focused pane", so it must be visible.
- **D4 – Shortcuts:** `Cmd+D` (split right) and `Cmd+Shift+D` (split down) on macOS; `Ctrl+Shift+D` and `Ctrl+Shift+E` elsewhere (plain `Ctrl+D` is end-of-input in a shell). Like Back (#4 D8) and Settings (#10 D5), they reach the view while a terminal has focus and the terminal never receives the key; they act on keydown only and do nothing while a dialog is open, while the card isn't running, or at 4 panes. They are matched by a core shortcut function next to `isBackShortcut`. *Why:* round 1 Q4; `Cmd+D` is the macOS terminal convention.
- **D5 – Closing an extra pane:** each extra pane has a close button (`×`, `aria-label="Close pane"`) in its top-right corner; the main pane has none. Clicking it kills that pane's shell (no confirmation) and removes the pane at once; its sibling in the split tree takes the freed space. An extra pane whose shell exits by itself (`exit`) is removed the same way. An extra pane whose shell couldn't start shows `Couldn't start: <reason>` read-only (as #5 D8) and stays until closed. *Why:* round 1 Q5; `Cmd+W` is taken by Electron's default menu (it closes the window).
- **D6 – One unit with the card:** when the main pane's shell stops for any reason (it exits, the card is Closed (#7), the page reloads), every extra pane's shell is killed, the extra panes are discarded, the card is `Stopped` and the view goes back to the board (#5 D6). Deleting a card kills every pane's shell. Starting a Stopped card again (#5 D7) gives it only its main pane. Back leaves every pane running. The Close and delete confirmations are unchanged and count a card once, by its main pane (#5 D13, #7 D6). *Why:* round 1 Q6: `Stopped` keeps meaning nothing runs.
- **D7 – Not saved:** panes and their layout live in the renderer's memory while the app runs; they are not part of **Saved state** and `drovr-state.json` keeps version 1 with the same fields. After a restart every card is `Stopped` with only its main pane. *Why:* round 1 Q7; processes never survive a restart (#8).
- **D8 – Status and `board`:** the card's status and last output line on the board come from the main pane only (#4 D9); an extra pane's output never shows there. Every extra pane's shell gets the same `board` variables as the main pane (#9 D3), so `board move . <column>` and `board status . <text>` from any pane act on the card. Main records every live session of a card (not only the latest), so the card counts as having a live shell while any of its sessions is live, and a `board` request is relayed to the window owning them; closing an extra pane never makes `board` refuse the main pane. *Why:* round 1 Q8; today main keeps one session per card, which a closed extra pane would wipe out.
- **D9 – Fit and appearance:** each pane fits its own area and refits whenever the view, or the split tree, changes size; its columns and rows reach its own PTY as a resize. Settings (#10 D3, D4) apply to every pane's screen like any other. Only attached panes hold a WebGL context (at most 4 per open card). *Why:* every pane is an ordinary card screen.
- **D10 – Security unchanged:** no new IPC channel: extra panes use `terminal:spawn` (with the card's id), `write`, `resize` and `kill` with their existing checks. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md.

## Acceptance criteria

Workspace `alpha` with working directory `/tmp/drovr-alpha` (an existing directory), the default columns and default startup command `Shell`; card `api` in `Running`, open at full size and running in the default window, unless stated otherwise. "The panes" are the elements with `data-testid="pane"` inside the card view, in tree order (left before right, top before bottom).

- **AC1 – Split right:** When the user clicks `Split right`, then the view shows 2 panes side by side, each about half the terminal area's width (within 10 px) and its full height; the right one is focused (`data-focused="true"`), typing `pwd` and Enter there prints `/tmp/drovr-alpha`, and the main pane's earlier output is still on its screen.
- **AC2 – Split down, nesting and the limit:** Given AC1's 2 panes with the right one focused, when the user clicks `Split down`, then there are 3 panes: the main pane at the left with full height, and the right half split into two stacked panes of about half its height, the bottom one focused. When the user then presses `Ctrl+Shift+D` (Linux; `Cmd+D` on macOS) with the bottom pane's terminal focused, there are 4 panes, the newest focused, and no `D`, `d` or control character reached any shell (the previous focused pane's screen shows no new input). Then `Split right` and `Split down` are disabled, and `Ctrl+Shift+D` / `Ctrl+Shift+E` change nothing.
- **AC3 – Plain shell in extra panes:** Given Claude Code card `agent` running the fake `claude` (#5's smoke tests), when the user splits it right, then the fake claude's log gained no new line, and in the new pane `echo extra-$((1+1))` prints `extra-2`.
- **AC4 – Focus by click:** Given 2 panes with the right one focused, when the user clicks the main pane, then the main pane is focused and typing `echo hi` and Enter shows `hi` in the main pane and nothing new in the right one.
- **AC5 – Closing an extra pane:** Given 3 panes from AC2's first step, when the user clicks `Close pane` on the bottom-right pane, then 2 panes remain side by side at half width each, the main pane is focused, and that pane's shell process has ended. When the user types `exit` and Enter in the remaining extra pane, then 1 pane remains, filling the terminal area, and `api` is still `Running`. The main pane has no `Close pane` button.
- **AC6 – Back keeps the panes; status from the main pane:** Given 2 panes where the main pane last printed `main-line` and the extra pane then printed `extra-line`, when the user goes Back, then `api` on the board reads `Running` with last line `main-line`; when the user opens `api` again, the same 2 panes show with their output and the previously focused pane focused, and both shells are still running.
- **AC7 – The main shell stopping ends every pane:** Given 3 panes, when the user types `exit` in the main pane, then the board is shown, `api` reads `Stopped`, and both extra panes' shell processes have ended; opening `api` again shows 1 pane. Given 2 panes, when the user Closes the card from the header and confirms (#7), then all its shell processes end and `api` reads `Stopped`.
- **AC8 – Delete counts the card once:** Given `api` running with 3 panes and no other running card in `alpha`, when the user deletes `alpha`, then the confirmation says `1 terminal is still running and will be stopped.`; on confirm, all 3 shell processes end. Deleting a running card with 2 panes from its menu ends both shells.
- **AC9 – `board` from any pane:** Given 2 panes, when the extra pane runs `board status . building`, then `api` on the board reads `Running · building`; when it runs `board move . Done`, then `api` is the last card in `Done`. Then after the user closes the extra pane, `board status . again` run in the main pane exits 0 and `api` reads `Running · again`.
- **AC10 – Not kept across restarts:** Given `api` with 3 panes, when Drovr is quit and started again, then `api` reads `Stopped`, opening it shows 1 pane, and `drovr-state.json` is version 1 with no pane or layout fields.
- **AC11 – Font size reaches every pane:** Given 2 panes side by side, when the user sets Font size `18` in Settings, then both panes' terminals use 18 px, and `tput cols` in each pane prints that pane's own column count (each less than before).
- **AC12 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Split right and close a pane:** a plain core module for the split tree (D2, D5: split a leaf right or down into equal halves, remove a leaf so its sibling takes its place, the 4-pane limit, leaves in tree order, focus rules of D3), unit-tested; extra-pane sessions per card in the renderer's terminal layer (spawn a plain shell with the card's id and directory, no start line; remove on exit; kill on close; `Couldn't start` read-only), sharing the existing session routing rather than registering a second, racing listener for early output; the full-size view renders the tree (each pane its own fitted screen, focus outline, click to focus, `Close pane`), with the `Split right` button. New `e2e/panes.spec.ts`. Satisfies AC1, AC4, AC5.
2. **S2 – Split down, shortcuts and the limit:** `Split down`, the D4 shortcut matcher in core (unit-tested for both platforms and every modifier mix) handled in the view's capture-phase listener and swallowed by the terminal's key handler, disabled buttons and ignored shortcuts at 4 panes or with a dialog open; each pane refits after every split or close (D9). e2e AC2, AC3, AC11. Satisfies AC2, AC3, AC11.
3. **S3 – Panes live and die with the card:** main pane stop kills and discards the extra panes (D6), delete kills them, a restart gives only the main pane, Back keeps the layout and focus; the board's status from the main pane only (D8); main's session-to-card record keeps every live session of a card (unit-tested: closing one of two sessions keeps the card live). e2e AC6–AC10. `CONTEXT.md` gains **Pane** (main pane, extra pane; not saved state; not a card); `AGENTS.md`'s smoke-test list names `e2e/panes.spec.ts`. Satisfies AC6, AC7, AC8, AC9, AC10, AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (split tree) + e2e | Open `api`, click Split right; read pane boxes and `data-focused`; type `pwd` in the new pane; read both buffers |
| AC2 | unit (tree, shortcut matcher) + e2e | Split down; press Ctrl+Shift+D in the focused terminal; read pane boxes, count, buffers; check buttons disabled and shortcuts ignored at 4 |
| AC3 | e2e (fake claude) | Split a Claude Code card; read the fake claude log; echo in the new pane |
| AC4 | e2e | Click the main pane; type; read both buffers |
| AC5 | unit (tree removal) + e2e | Click Close pane; read boxes, focus, the shell's pid liveness; `exit` in the other extra pane |
| AC6 | e2e | Print in each pane; Back; read the board's status line; reopen; read panes and focus |
| AC7 | e2e | `exit` in the main pane; check board, status and extra pids; reopen; Close from the header |
| AC8 | e2e | Delete the workspace; read the confirmation; check pids; delete a card from its menu |
| AC9 | unit (session-to-card record) + e2e | Run `board status`/`board move` in the extra pane; close it; `board status` in the main pane |
| AC10 | e2e | Restart through `e2e/launch.ts` with the same data dir; open `api`; read `drovr-state.json` |
| AC11 | e2e | Set font size 18; read each xterm's font size; run `tput cols` in each pane |
| AC12 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS that `Cmd+D` and `Cmd+Shift+D` split the focused pane and nothing reaches the shell.

## Stack changes

None: panes are more xterm.js screens and node-pty sessions; no new dependency or service.

## Data and migrations

None. `drovr-state.json` and `drovr-settings.json` are unchanged; panes are never saved.

## Out of scope

- Draggable dividers or uneven splits; zooming a pane to the full view.
- Keyboard shortcuts to move focus between panes or close a pane.
- A startup command, title or status of its own for an extra pane; showing extra panes' output on the board.
- Saving panes or their layout across restarts; restarting extra panes' shells.
- Moving a pane to another card or turning it into a card.
- Panes on the board's card tiles (they still show the main pane's status only).

## Open questions

None.
