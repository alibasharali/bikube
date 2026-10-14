---
item: 22
type: bug
title: Startup line can show garbled when a card opens at full size
status: approved
branch: claude/22-startup-line-garbled
---

# Startup line can show garbled when a card opens at full size

## Problem

Every card start is followed by opening it at full size (opening a card, creating one). The card registry creates the card's screen and spawns its PTY at once, at the screen's size before any view fitted it (80×24); the full-size view then fits the screen wider (e.g. 103 columns), and when the spawn comes back the registry sends the resize and types the startup line straight after. Bash can read the line while its readline still wraps at 80, so its `\r` redraw on SIGWINCH overwrites the row in the wider terminal: a long typed line (Claude Code resume, ~132 characters with the prompt) shows garbled until it scrolls. The command runs correctly. Parent: #8.

## Decisions

- **D1 – Spawn at the fitted size:** a card's shell is spawned only after the view that opens it had its chance to attach and fit the new screen (the registry defers the spawn past the current task in the app), so the PTY and the shell start at the size the user sees. The resize after the spawn stays, for a view that fits while the shell is starting.
- **D2 – Nothing else changes:** a card closed or deleted before its deferred spawn behaves as one closed or deleted while its shell is starting (killed as soon as it arrives); starting a card that is already starting does nothing. Extra panes (#11) have no startup line and are unchanged.

## Acceptance criteria

- **AC1 – Spawned at the fitted size:** Given a card registry whose spawns are deferred, when a card starts and its screen is resized before the deferred spawn runs, then the PTY is spawned at the resized columns and rows and no resize is sent after the spawn. (unit, `card-sessions`.)
- **AC2 – Close and delete during the deferral:** Given a card whose spawn is still deferred, when it is closed, its shell is killed as soon as it arrives and the start line isn't typed; when it is deleted, the spawn's session is killed. (unit, `card-sessions`.)
- **AC3 – The typed line is intact:** Given a Custom card whose command is a single `echo` longer than 80 columns plus the prompt, when it is opened at full size (wider than 80 columns), then the shell's PTY reports the open view's columns (`tput cols` equals the xterm's columns) and the typed command shows on one unwrapped row of the terminal, exactly as typed after the prompt. (e2e `e2e/startup.spec.ts`.)
- **AC4 – No regressions:** the existing startup, SSH, panes and persistence e2e tests stay green.

## Slices

1. **S1 – Spawn after the view fitted the screen:** the registry spawns a card's shell through a deferral the app sets to after the current task; unit tests for the deferral and an e2e test for the long startup line. Satisfies AC1–AC4.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | Vitest `src/core/card-sessions.test.ts` | `npm test` |
| AC3 | e2e `e2e/startup.spec.ts` | `xvfb-run -a npm run test:smoke` |
| AC4 | e2e `e2e/*.spec.ts` | `xvfb-run -a npm run test:smoke` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Extra panes' spawn size (no startup line to garble).
- How readline handles SIGWINCH.

## Open questions

None.
