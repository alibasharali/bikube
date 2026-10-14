---
item: 19
type: chore
title: Restore terminal e2e coverage and benchmark on the board
status: approved
branch: claude/19-restore-terminal-e2e
---

# Restore terminal e2e coverage and benchmark on the board

## Problem

#2 removed the spike UI, so `e2e/terminal.spec.ts` (#1 AC3–AC7: typing, resize, colours, copy and paste) was deleted and `e2e/benchmark.spec.ts` stopped working. Since then, #4 rewrote the benchmark against cards (10 cards in one workspace, one open at full size; #16 added the firehose profile), and `e2e/cards.spec.ts` covers typing (AC1 `pwd`) and resize (D7 `tput cols` after a window resize). Two #1 behaviours still have no e2e test on the board: colour rendering (#1 AC6) and copy and paste (#1 AC7, `src/core/clipboard.ts` wired in the card terminal). After this ships, `npm run test:smoke` covers both again in a card's terminal, and `npm run benchmark` runs on the board as before. Parent: #2.

## Domain decisions

- **D1 – Port, don't rewrite:** the colour and clipboard tests keep #1's assertions (the same escape sequences and cell checks, the same copy and paste steps) and only change how the terminal is reached: a workspace and a card are created through the UI and the test drives the open card's terminal (`[data-testid=card-view] [data-testid=terminal]`). *Why:* #1's ACs are the behaviour to keep; the board is only the new way in.
- **D2 – No duplicate tests:** typing, resize and the benchmark are already covered on the board (`cards.spec.ts` AC1 and D7, `benchmark.spec.ts`); this item doesn't add second copies. *Why:* the item asks for coverage, which exists for those.

## Acceptance criteria

- **AC1 – Colours:** Given an open card, when the 16 ANSI colours (30–37, 90–97), 256-colour 196/21/244 with background 82, and truecolor #123456, #ff0080 with background #010203 are written to its terminal, then the cells carry palette colours 0–15, palette 196/21/244 and palette background 82, and RGB 0x123456, 0xff0080 and RGB background 0x010203. (e2e `e2e/terminal.spec.ts`.)
- **AC2 – Copy:** Given an open card whose terminal shows `copy-me  spaced` selected, when Ctrl+Shift+C (Cmd+C on macOS) is pressed, then the clipboard holds exactly `copy-me  spaced`. (e2e `e2e/terminal.spec.ts`.)
- **AC3 – Paste:** Given the clipboard holds `echo pasteA\necho pasteB`, when Ctrl+Shift+V (Cmd+V on macOS) and then Enter are pressed in the card's terminal, then lines exactly `pasteA` and `pasteB` appear in its output. (e2e `e2e/terminal.spec.ts`.)
- **AC4 – Benchmark runs:** `xvfb-run -a npm run benchmark` passes on the board UI and writes `test-results/benchmark-sustained.md`. (Run by hand; already true on `main`.)

## Slices

1. **S1 – Terminal e2e on a card:** `e2e/terminal.spec.ts` creates a workspace and a card, then runs the colour, copy and paste tests against the open card's terminal; `AGENTS.md` lists it among the smoke tests. Satisfies AC1–AC4.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `e2e/terminal.spec.ts` | `xvfb-run -a npm run test:smoke` |
| AC2 | e2e `e2e/terminal.spec.ts` | same |
| AC3 | e2e `e2e/terminal.spec.ts` | same |
| AC4 | `npm run benchmark` | `xvfb-run -a npm run benchmark` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Changes to the terminal, clipboard or benchmark code.
- Re-adding typing and resize tests already in `e2e/cards.spec.ts`.

## Open questions

None.
