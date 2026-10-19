---
item: 61
type: bug
title: worktree-setup e2e "AC9" flaky under zsh (typed line read before echo)
status: approved
branch: claude/61-worktree-setup-flake
---

# worktree-setup e2e "AC9" flaky under zsh (typed line read before echo)

## Problem

`e2e/worktree-setup.spec.ts`'s AC9 fails about half its runs when the e2e app's `SHELL` is zsh (bash, as in CI, and sh pass). Drovr types the setup line a few milliseconds after the spawn, before zsh turns tty echo off, so whether the line ends up on screen as one soft-wrapped line or as zsh's redraw (`. \r\e[K \r failed` at 72 columns, where xterm's erase-in-line clears the row's wrapped flag) is a race. In the redraw case `setup .` and ` failed` sit on separate, unjoined rows and `toContain('setup . failed')` fails. After this ships the test passes whatever the shell and however it redraws the typed line.

## Domain decisions

- **D1 – Fix the test, not the app:** the assertions that look for the typed setup line read the screen with every run of whitespace (newlines included) collapsed to one space, so a line split by the shell's redraw still matches. *Why:* the app's behaviour is right (the line is typed and runs; the `Setup failed` pill the test already checks proves the outcome); waiting for the shell to be ready before typing (option 2) changes every card's start for a test-only race.
- **D2 – Same reading for the negative check:** AC10's `not.toContain('setup . ok')` uses the collapsed reading too, so a split line can't make it pass vacuously.

## Acceptance criteria

- **AC1 – AC9 passes under zsh:** Given zsh as the e2e app's `SHELL`, when AC9 of `e2e/worktree-setup.spec.ts` runs 12 times, then every run passes (before: about half fail at the `setup . failed` poll).
- **AC2 – Unchanged under bash:** Given the default shell, when `e2e/worktree-setup.spec.ts` runs, then every test passes.

## Slices

1. **S1 – Whitespace-collapsed screen reading:** a helper in `e2e/worktree-setup.spec.ts` used by AC9's two typed-line polls and AC10's `setup . ok` check. Satisfies AC1, AC2.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | `SHELL=/usr/bin/zsh xvfb-run -a npx playwright test e2e/worktree-setup.spec.ts -g AC9 --repeat-each=12` |
| AC2 | e2e | `xvfb-run -a npx playwright test e2e/worktree-setup.spec.ts` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Delaying the setup or startup line until the shell is ready.
- Other specs' typed-line reads (none reported flaky).

## Open questions
