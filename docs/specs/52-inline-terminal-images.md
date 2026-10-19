---
item: 52
type: feature
title: Inline images in terminals
status: draft
branch: claude/52-inline-terminal-images
---

# Inline images in terminals

## Problem

Agents doing UI work take screenshots, plot data or show images with `imgcat`, `chafa -f sixels` or `img2sixel`; today Drovr's terminals drop those escape sequences, so the user has to open the file elsewhere. After this ships, images printed with the sixel or the iTerm2 inline image protocol (OSC 1337 `File=`) show inside the terminal where they were printed, in a card's main pane, its extra panes and a workspace's shells, local or over SSH, while keeping memory bounded with 10+ terminals open (#1's benchmark).

## Domain decisions

- **D1 – Protocols:** sixel (DCS `q`) and iTerm2's inline images (OSC 1337 `File=…:<base64>`, `inline=1`) render, through xterm.js's own image addon (`@xterm/addon-image`, the version matching `@xterm/xterm` 6, as VS Code's terminal uses). The Kitty graphics protocol does not. *Why:* the addon covers both protocols; Kitty graphics would need a parser and renderer of our own (rejected: far beyond the item's size).
- **D2 – Every terminal:** every terminal screen (a card's main pane, extra panes, the Default shell and named shells; local and SSH, since the sequences come through the connection) loads the addon when it is created, whether or not a view shows it yet, so an image printed while the user is on the board is there when the card is opened. It works with both the WebGL and the DOM renderer. The image scrolls with its text rows, goes into the scrollback with them and is gone when they leave it or are erased.
- **D3 – Setting:** **Inline images**, a switch in Settings' terminal section after Shell integration, hint `Show sixel and iTerm2 images in terminals. Applies to new terminals.`, on by default, a `Preferences` entry (`inlineImages`, boolean) written to `drovr-settings.json` only when off. A terminal reads it when its screen is created (each start of a card or shell, each new pane); changing it never touches an open terminal. With it off no addon is loaded, and the sequences are ignored as today. *Why:* like Shell integration (applies to new terminals); a live switch would drop images mid-session for little gain (rejected).
- **D4 – Memory:** each terminal holds at most 32 MB of image data (the addon's `storageLimit`, in MB); beyond it the oldest images are dropped. A single image is limited to the addon's default 16,777,216 pixels (`pixelLimit`) and a sixel sequence to its default 25 MB (`sixelSizeLimit`); larger ones are not shown. The addon's other options keep their defaults, except `enableSizeReports`, kept on so programs such as `chafa` can size images to the cell size. *Why:* 10+ terminals at the addon's default 128 MB could pass 1 GB (rejected); 32 MB still holds several full-screen screenshots.
- **D5 – Not kept:** images are runtime only. Kept output (#46) stays text only (its rows where an image was are blank, as the serialize addon writes no images), the board card's status lines are text as today, and nothing about images is saved or synced. *Why:* images are a live-session aid; saving them would bloat kept-output files (rejected).

## Acceptance criteria

- **AC1 – Setting:** Given `drovr-settings.json` without `inlineImages`, then the preference reads `true`; given `"inlineImages": false`, it reads `false`; given a non-boolean value, the default `true`; saving `true` writes no `inlineImages` key, saving `false` writes `"inlineImages": false`. (Vitest, settings.)
- **AC2 – Sixel in a card:** Given a running card open at full size, when its shell prints a small sixel image (e.g. a 20×20 px red square, typed with `printf`), then the terminal holds an image at the cell where it was printed (the addon's image at that buffer cell is non-empty) and the text printed after it follows below the image.
- **AC3 – iTerm2 image:** Given a running card, when its shell prints a small PNG with `ESC ] 1337 ; File=inline=1;size=<n>:<base64> BEL`, then the terminal holds an image at that cell.
- **AC4 – Printed while away:** Given a card printing a sixel image while the board shows (its view not open), when the card is opened, then the image is there.
- **AC5 – Extra pane and shells:** Given a card split right, when the extra pane prints a sixel image, then that pane holds it; given the workspace's Default shell, when it prints one, then it holds it.
- **AC6 – Switched off:** Given Inline images turned off in Settings, when a card is started and prints the same sixel and iTerm2 sequences, then its terminal holds no image and shows none of the sequences' data as text; a terminal already open when it was switched off keeps showing its images.
- **AC7 – Settings switch:** Given the Settings dialog, then the terminal section shows the Inline images switch, on; turning it off writes `"inlineImages": false` to `drovr-settings.json` and the switch reads off after a restart.
- **AC8 – Kept output:** Given a card that printed an image and then text, when it is Closed and opened again, then the previous output above the separator shows the text, and no image.
- **AC9 – No regressions:** the existing smoke tests stay green, and `npm run benchmark` (sustained) still meets its budget.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Images in every terminal:** add `@xterm/addon-image`; each terminal screen loads it at creation with D4's limits; the test hook exposes whether a cell holds an image; e2e for sixel, iTerm2, printed while away, extra pane, Default shell and kept output. Satisfies AC2, AC3, AC4, AC5, AC8.
2. **S2 – Inline images setting:** the `inlineImages` preference, its Settings switch, a screen loading the addon only while it is on; Vitest and e2e. Updates AGENTS.md (the new e2e file, the preferences list) and CONTEXT.md (Settings). Satisfies AC1, AC6, AC7, AC9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest `src/core/settings.test.ts` | `npm test` |
| AC2–AC5, AC8 | e2e `e2e/inline-images.spec.ts` (reads the image at a buffer cell through the terminal element's test hook) | `xvfb-run -a npm run test:smoke` |
| AC6, AC7 | e2e `e2e/inline-images.spec.ts` | `xvfb-run -a npm run test:smoke`; Settings > Inline images |
| AC9 | all e2e; `e2e/benchmark.spec.ts` | `xvfb-run -a npm run test:smoke`, `xvfb-run -a npm run benchmark` |

## Stack changes

None: `@xterm/addon-image` is another addon of xterm.js, already in the stack (like the serialize addon, added by #46).

## Data and migrations

`drovr-settings.json` gains an optional `inlineImages` boolean (absent means on). Existing files need nothing.

## Out of scope

- The Kitty graphics protocol, and iTerm2's file downloads (`inline=0`).
- Saving, copying or opening an image (no context menu or click action).
- Images in kept output, the board card or the theme preview.
- A live toggle for open terminals; limits the user can change.

## Open questions

None.
