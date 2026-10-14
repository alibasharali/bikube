---
item: 24
type: chore
title: 'Flaky smoke test: settings AC3 snapshots the terminal before the prompt prints'
status: approved
branch: claude/24-settings-ac3-flake
---

# Flaky smoke test: settings AC3 snapshots the terminal before the prompt prints

## Problem

`e2e/settings.spec.ts` "AC3: picking Light recolours the board…" types `echo marker-$((40+2))`, waits until a buffer line is `marker-42` and saves the buffer right then as `scrollback`. The shell prints its next prompt after the echo's output, so that prompt can land after the snapshot, and the later `expect(await bufferLines(page)).toEqual(scrollback)` (meant to prove a theme change keeps the terminal's contents) sees one line more. It failed once in a full `test:smoke` run during #11 and passed on its own. Parent: #11.

## Decisions

- **D1 – Snapshot a settled buffer:** AC3 takes `scrollback` only once the buffer holds `marker-42` and two reads 300 ms apart are equal (a `settledBufferLines` helper in `e2e/settings.spec.ts`, polled with Playwright's `expect.poll`). *Why:* the prompt's text depends on the user's shell and profile, so waiting for a specific prompt isn't portable; an unchanged buffer means the shell is idle at its prompt, and the rest of the test types nothing more into the shell.

## Acceptance criteria

- **AC1 – Snapshot after the prompt:** the AC3 test compares against a buffer read once it has stopped changing after `marker-42`. (e2e `e2e/settings.spec.ts`; passes 20 times in a row.)
- **AC2 – No regressions:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` stay green.

## Slices

1. **S1 – Settled snapshot:** D1 in `e2e/settings.spec.ts`. Satisfies AC1–AC2.

## Test seams and verification

| AC | Test seam | How to verify |
|---|---|---|
| AC1 | e2e `e2e/settings.spec.ts` | `xvfb-run -a npx playwright test e2e/settings.spec.ts -g AC3 --repeat-each 20` |
| AC2 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Other specs' buffer snapshots (none is reported flaky).

## Open questions

None.
