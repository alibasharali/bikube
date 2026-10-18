---
item: 58
type: bug
title: Shift-Enter not working in "Shells"
status: approved
branch: claude/58-shift-enter-shells
---

# Shift-Enter not working in "Shells"

## Problem

Shift+Enter sends ESC CR, which Claude Code takes as a new line, only in a Claude Code card's main pane while focus reporting is on. A workspace's shells (the Default shell and named shells) are never Claude Code cards, so Claude Code started in one gets xterm's plain CR for Shift+Enter and submits the prompt instead of starting a new line. The same holds in a card's extra panes and in a card that doesn't start Claude Code. The card rule exists because ESC CR misfires elsewhere (bash beeps and runs nothing; an editor such as Neovim, which also turns focus reporting on, would leave insert mode), so focus reporting alone can't stand for "Claude Code runs here".

Claude Code (checked on 2.1.303) sends a probe no other common program sends at startup, right after turning focus reporting on: OSC 7501 (`ESC ] 7501 ; ? BEL`, its "program status" query, which xterm.js ignores). It turns focus reporting off (`CSI ? 1004 l`) when it exits.

## Decisions

- **D1 – Claude Code recognised in any pane:** a terminal that receives OSC 7501 counts as running Claude Code until focus reporting is next turned off in it (`CSI ? 1004 l`, also as one of several modes in one sequence) or until its screen is replaced. While it counts, and focus reporting is on, Shift+Enter sends ESC CR, in every pane: a workspace's shells, a card's extra panes, plain cards, SSH cards (the probe comes through the connection).
- **D2 – The card rule stays:** a Claude Code card's main pane keeps sending ESC CR while focus reporting is on, probe or not (older Claude Code versions, and the e2e fake).
- **D3 – Nothing else changes:** OSC 7501 gets no reply (as today), and every sequence keeps reaching xterm's own handlers. Without the probe, Shift+Enter stays xterm's CR wherever it is today.

## Acceptance criteria

- **AC1 – The rule:** Given the Shift+Enter rule, then it is ESC CR for a Claude Code card's main pane with focus reporting on, or for any pane that saw Claude Code's probe with focus reporting on, and CR otherwise (no focus reporting; no card rule and no probe). (unit, `terminal-keys`.)
- **AC2 – In a shell:** Given a workspace's Default shell where a program turns focus reporting on, prints OSC 7501 and reads the terminal with `od -c`, when Shift+Enter is pressed, then the program reads ESC CR; once it turns focus reporting off and exits, Shift+Enter at the shell is a plain CR (no ESC). (e2e `e2e/shift-enter.spec.ts`.)
- **AC3 – In an extra pane:** Given a Claude Code card's extra pane running the same program, Shift+Enter is ESC CR; a pane that only turns focus reporting on (no probe) still gets a plain CR. (e2e `e2e/shift-enter.spec.ts`.)
- **AC4 – No regressions:** the existing Shift+Enter, terminal, panes and shells e2e tests stay green.

## Slices

1. **S1 – Recognise Claude Code's probe in every terminal:** the rule takes the probe; each terminal screen watches for OSC 7501 and for focus reporting turned off; unit and e2e tests. Satisfies AC1–AC4.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest `src/core/terminal-keys.test.ts` | `npm test` |
| AC2, AC3 | e2e `e2e/shift-enter.spec.ts` | `xvfb-run -a npm run test:smoke` |
| AC4 | e2e `e2e/*.spec.ts` | `xvfb-run -a npm run test:smoke` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- The kitty keyboard protocol or modifyOtherKeys (xterm.js has neither; Claude Code would then get Shift+Enter natively).
- Reading the foreground process from the PTY (on macOS it names `node` or the version-named binary, not Claude Code).
- Replying to Claude Code's probes.

## Open questions

None.
