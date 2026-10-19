---
item: 60
type: feature
title: "Select a command's output (shell integration marks)"
status: approved
branch: claude/60-select-command-output
---

# Select a command's output (shell integration marks)

## Problem

Copying what a command printed (a failing test run, a stack trace to paste into an agent) means dragging a mouse selection across a long, scrolling output. #45 marks where each command's output starts (OSC 133/633 `C`) and ends (`D`) in every terminal whose shell sends the marks. After this item, one shortcut or palette row selects the output of the last command, or of the command at the prompt the user scrolled to with Previous/Next prompt, and copies it to the clipboard. Follow-up of #45, whose marks it builds on (merged).

## Domain decisions

- **D1 – A command's output:** an ended command's (#45 D2) output is the text from where its `C` arrived (the cursor's row and column when the `C` was parsed) up to where its `D` arrived, exclusive. A `D` at column 0 ends the output at the end of the row above. The text is what xterm's selection of that range gives (wrapped rows joined, line ends trimmed); trailing empty lines are dropped. A command whose output is empty after that, or whose `C` row has left the scrollback, has no output. Marks parsed while a previous run's output is restored (#46) are still ignored (#45 D7). *Why:* the positions, not just the rows, keep the command line and the next prompt out when a shell sends `C` or `D` mid-row.
- **D2 – Copy command output:** one card-view action, `Copy command output`, acts on the focused pane of the open card or shell (main pane, extra pane, Default or named shell, local or SSH, any terminal that sent the marks). It selects the chosen command's output (D3) in that pane, as a user selection, and writes the same text to the clipboard. The view does not scroll. The selection behaves as any selection: it is replaced by the next click or selection, and Copy (Cmd+C / Ctrl+Shift+C) copies it again. With Copy on select on, the clipboard gets the text once. With the find bar open the selection is the user's, not Find's (#35 D9): Find's highlights stay and the next Find step selects its match again. *Why:* copying is what the selection is for; one action keeps Settings and the palette small, and the visible selection shows what was copied (rejected: select only; separate Select and Copy actions).
- **D3 – Which command:** only ended commands count (a running one's output keeps moving; rejected: its output so far). When the pane's viewport is at the bottom of its scrollback, the last ended command with output. When scrolled up (by Previous prompt, the mouse, anything): the first ended command with output whose command line (#45 D2) is in the viewport; else the last ended command with output whose line is above the viewport's top row; else none. *Why:* covers the item's two cases: the last command, and the command at a prompt reached with Previous/Next prompt (its line is at or just below the top row), plus reading a long output scrolled to its middle.
- **D4 – Nothing to copy:** with no command per D3 (no marks, every output empty, the alternate screen shown, no terminal in the focused pane), the action does nothing: selection and clipboard unchanged, no message. The pane's shell never receives the keys, also then (#31 D7). *Why:* like Previous prompt without a prompt (#45 D5); no new UI.
- **D5 – Where it is offered:** a new shortcut `Copy command output`, default Shift+Cmd+A on macOS (iTerm2's Select Output of Last Command) and Ctrl+Shift+A elsewhere (Ctrl+A stays the shell's), recordable, refused and Reset in Settings' Shortcuts section like the others, saved in `shortcuts` as `copyCommandOutput` only when changed. A command palette row `Copy command output` with its shortcut, listed with the open view's actions whenever the focused pane has a terminal (as Find's row), runs exactly what the shortcut runs (#40 D6). *Why:* the item asks for a shortcut and the palette; the row's condition matches Find's so it needs no live reading of marks.

## Acceptance criteria

- **AC1 – Picking the command and its range:** Given ended commands with output start, end and line positions, when the command is chosen with the viewport at the bottom, then it is the last ended one with output; with the viewport's top at the second of three commands' prompt, the second; with the top inside the second's output and the third's line below the viewport, the second; a command with `C` and `D` at the same position, a running command, or one whose `C` row is gone is never chosen; a `D` at column 0 ends the range at the end of the row above. (Vitest, core)
- **AC2 – Copy the last command's output:** Given a workspace's Default shell (Shell `/bin/sh`) where the user ran a line printing `A`/`B` marks, then `C`, `one`, `two` on two lines and `D;0`, and then the same for a command printing `three`, when the user presses Ctrl+Shift+A, then the terminal's selection and the clipboard both read `three`; the shell received none of the keys. (e2e)
- **AC3 – After Previous prompt:** Given that shell after the two commands, when the user presses Previous prompt until the first command's prompt is the viewport's top row and then Ctrl+Shift+A, then the clipboard reads `one\ntwo`. (e2e, with enough output between them to scroll)
- **AC4 – Nothing to copy:** Given a shell with no marks and the clipboard holding `before`, when the user presses Ctrl+Shift+A, then the clipboard still reads `before` and there is no selection; the same after a marked command with empty output. (e2e)
- **AC5 – End to end in bash:** Given Shell `/bin/bash` with Shell integration on, when the user runs `printf 'x\ny\n'` in a card's extra pane (focused) and presses Ctrl+Shift+A, then the clipboard reads `x\ny`. (e2e)
- **AC6 – Palette and Settings:** Given an open card with a terminal, when the palette is opened and `copy output` typed, then a `Copy command output` row with `Ctrl+Shift+A` shows, and Enter copies as the shortcut does; Settings' Shortcuts section lists `Copy command output`, records a new key that then works, and Reset brings back Ctrl+Shift+A. (Vitest for the palette rows and keymap defaults, e2e for the rest)
- **AC7 – With Find open:** Given the find bar open on a match in the pane, when the user presses Ctrl+Shift+A, then the clipboard holds the command's output and the selection is the output, not the match. (e2e)
- **AC8 – No regressions:** every existing Vitest and e2e test stays green.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Output positions and the choice:** the mark state keeps each command's `C` and `D` positions (row handle and column) and forgets a command whose `C` row leaves the scrollback; a core function picks the command and its range (D1, D3). Satisfies AC1.
2. **S2 – The action and its shortcut:** the `copyCommandOutput` shortcut with its defaults and Settings row, the card-view action selecting and copying in the focused pane, the Find and copy-on-select interplay (D2, D4, D5's shortcut). Satisfies AC2, AC3, AC4, AC5, AC7.
3. **S3 – Palette row** (D5). Satisfies AC6, AC8.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest, `src/core` (mark state, command choice) | `npm test` |
| AC2 | e2e `e2e/shell-integration.spec.ts` | Default shell, print the marks with `printf`, press the shortcut, read the selection and the clipboard |
| AC3 | e2e `e2e/shell-integration.spec.ts` | as AC2, Previous prompt first |
| AC4 | e2e `e2e/shell-integration.spec.ts` | clipboard written beforehand, press the shortcut |
| AC5 | e2e `e2e/shell-integration.spec.ts` | Shell `/bin/bash`, split, run `printf`, press the shortcut |
| AC6 | Vitest (`palette.test.ts`, `keymap.test.ts`) + e2e `e2e/palette.spec.ts`, `e2e/settings.spec.ts` | open the palette, type, Enter; record and Reset in Settings |
| AC7 | e2e `e2e/find.spec.ts` or `e2e/shell-integration.spec.ts` | Find a word, then the shortcut |
| AC8 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` |

Shared files: #53 (in review) also changes the keymap, the palette, `card-terminals.ts` and the card-view actions; whoever merges second keeps both.

## Stack changes

None.

## Data and migrations

`drovr-settings.json`'s `shortcuts` gains the action `copyCommandOutput`, written only when changed; files without it read the default. Nothing in the saved state or the sync file.

## Out of scope

- Copying a running command's output, the command line itself, or a command together with its output.
- Selecting several commands at once, or extending the selection command by command.
- A context menu on a pane, or a button on the failed-command badge.
- Any change to how marks are injected or to the prompt jumps.

## Open questions

None.
