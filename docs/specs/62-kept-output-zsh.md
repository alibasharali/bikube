---
item: 62
type: bug
title: kept-output e2e "D1" fails under zsh (prompt redraw clears below the cursor)
status: approved
branch: claude/62-kept-output-zsh
---

# kept-output e2e "D1" fails under zsh (prompt redraw clears below the cursor)

## Problem

`e2e/kept-output.spec.ts`'s D1 fails when the e2e app's `SHELL` is zsh (bash, as in CI, and sh pass). The test prints three lines and leaves the cursor two rows up, on `kept-a`, then lets the shell take over. Two things then write from that row: zsh's next prompt, which clears the screen below it (`kept-b` and `kept-c` gone before the card is even closed, every run), and, once a command keeps the shell busy, zsh's `zsh: warning: 1 jobs SIGHUPed` / `zsh: hangup` lines printed at Close (about half the runs). Kept output then saves exactly what was on screen, so the app is right: the test's setup depends on the shell. After this ships the test passes whatever the shell.

## Domain decisions

- **D1 – Fix the test, not the app:** the line ends in `exec sleep 30`, so the shell is replaced by a process still running at Close, as an agent's would be: no prompt is drawn and nothing is printed at the hangup. *Why:* #46's D1 is about an agent leaving its cursor up when the card closes; that is what the test now builds. Protecting kept lines from a live shell's own clear-below would change what the terminal showed, and pinning `SHELL=/bin/sh` for the file would hide shell differences other tests in it may still catch.

## Acceptance criteria

- **AC1 – D1 passes under zsh:** Given zsh as the e2e app's `SHELL`, when D1 of `e2e/kept-output.spec.ts` runs 12 times, then every run passes (before: every run failed at the `kept-c` poll).
- **AC2 – Unchanged under bash and sh:** Given bash or sh, when `e2e/kept-output.spec.ts` runs, then every test passes.

## Slices

1. **S1 – A running process at Close:** D1's typed line ends in `exec sleep 30`. Satisfies AC1, AC2.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | `SHELL=/usr/bin/zsh xvfb-run -a npx playwright test e2e/kept-output.spec.ts -g D1 --repeat-each=12` |
| AC2 | e2e | `SHELL=/bin/bash xvfb-run -a npx playwright test e2e/kept-output.spec.ts` (and `/bin/sh`) |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Shielding kept output from a new shell's clear-below in the live session.

## Open questions
