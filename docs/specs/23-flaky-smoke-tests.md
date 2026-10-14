---
item: 23
type: chore
title: 'Flaky smoke tests: window launch timeout and fake-claude buffer poll'
status: approved
branch: claude/23-flaky-smoke-tests
---

# Flaky smoke tests: window launch timeout and fake-claude buffer poll

## Problem

While building #9, two smoke tests each failed once and passed on a rerun, in files #9 didn't touch: `e2e/board.spec.ts` AC5 timed out waiting for the window at launch (`launchApp` in `beforeEach`), and `e2e/startup.spec.ts` AC9 "changing a card's command…" timed out on the poll for a buffer line ending in `claude --session-id <u>`. Neither reproduces on `main` (20 runs of each, and the whole `board.spec.ts` 4 times over, with the CPU overloaded). Parent: #9.

What the code shows:

- **AC9 poll:** the line it waits for is written twice: the typed startup line (`<prompt>claude --session-id <u>`) and the fake claude's own output (`fake-claude --session-id <u>`), which also ends with it. Both can only miss when a row is overwritten: before #22 the shell spawned at 80 columns and got its resize while the startup line was typed, so readline's SIGWINCH redraw could move the cursor back onto the typed row, and the fake claude's shorter output then overwrote it, leaving the end of the longer prompt line after it (the same garbling CI caught in `board-cli.spec.ts` on #12's branch). #22 removed that race (the shell spawns at the fitted size), but the poll still depends on a row's end, which any redraw can leave behind.
- **Launch:** `launchApp` waits on `firstWindow()` and then on `[data-testid=app]` with Playwright's defaults (30 s, then the rest of the test's 60 s), and on a timeout says nothing about what the app did. Nothing in main or the renderer waits on anything that can hang (the board socket starts asynchronously and only logs when it fails), so the hang is in Electron's own startup, which the test can't fix but must not fail on silently.

## Decisions

- **D1 – Match the start of the fake claude's line:** AC9 waits for a row that starts with `fake-claude --session-id <u>`, the line the fake claude prints on a fresh row after the shell ran it; a redraw can leave characters after it but never before. *Why:* that row proves the typed command ran with that id, and it can't be garbled by the typed row's redraw.
- **D2 – A launch that brings no window is retried once, loudly:** `launchApp` gives each launch 25 s in all to bring its window and the app's root (`DROVR_E2E_WINDOW_TIMEOUT_MS` overrides it); when they don't come, it prints the reason and the main process's stderr to the test's output, kills that app, extends the test's timeout by as much and launches once more on the same data directory. A second failure fails the test with both reasons. A caller's `onStderr` hears only the launch that is kept. *Why:* a launch hang is Electron's, not the app's behaviour under test; one retry with the evidence in the log keeps the suite green without hiding a launch that never works.

## Acceptance criteria

- **AC1 – AC9 robust to a garbled typed row:** the AC9 test waits on a buffer row starting with `fake-claude --session-id <u>`. (e2e `e2e/startup.spec.ts`; passes 20 times in a row.)
- **AC2 – Launch retried once:** Given an app that brings no window within the timeout, `launchApp` logs the reason and stderr, kills it and launches again on the same data directory; a second failure throws with both reasons. (e2e `e2e/board.spec.ts` AC5 passes 20 times in a row; the retry path checked by hand with a 1 ms window timeout.)
- **AC3 – No regressions:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` stay green.

## Slices

1. **S1 – Robust waits:** D1 in `e2e/startup.spec.ts`, D2 in `e2e/launch.ts`. Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify |
|---|---|---|
| AC1 | e2e `e2e/startup.spec.ts` | `xvfb-run -a npx playwright test e2e/startup.spec.ts -g "changing a card" --repeat-each 20` |
| AC2 | e2e `e2e/launch.ts` | `xvfb-run -a npx playwright test e2e/board.spec.ts -g AC5 --repeat-each 20`; the retry with `DROVR_E2E_WINDOW_TIMEOUT_MS=1` |
| AC3 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Electron's own startup hang.
- Other specs' polls on row ends (none is reported flaky).

## Open questions

None.
