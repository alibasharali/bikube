---
item: 18
type: chore
title: Make sure no shells survive app quit (SIGKILL escalation, e2e check)
status: approved
branch: claude/18-no-shells-survive-quit
---

# Make sure no shells survive app quit (SIGKILL escalation, e2e check)

## Problem

Found in the #1 review: "no PTY process outlives the app" (#1 AC9) is only unit-tested through `SessionManager.killAll()`. `SessionManager.kill` sends node-pty's default SIGHUP and never escalates, so a shell that ignores SIGHUP (`trap '' HUP`, `nohup`-style wrappers) keeps running after its card is closed or deleted, and after Drovr quits. The quit path (`before-quit` calling `killAll()` and the process exiting at once, windows destroyed) has no e2e test. After this ships, every shell Drovr kills is gone within a bounded time, the app waits for its shells before it exits, and an e2e test proves the shell pids are gone after `app.close()`. Parent: #1.

## Domain decisions

- **D1 – Escalation on every kill:** killing a session still sends SIGHUP first (so a login shell passes the hangup on to its jobs, #7 D2), and if the session has not exited **2,000 ms** later, its shell gets SIGKILL. The timer is dropped when the session exits. This applies to every kill (Close #7, delete, extra panes #11, page reload or crash, window close, quit), and replaces #7 D2's "No escalation to a stronger signal". The grace period is a named constant in the session manager. *Why:* the item asks for escalation; the same rule everywhere keeps one code path, and 2 s is ample for a shell to handle its hangup.
- **D2 – Quit waits for the shells:** on the first `before-quit` with live sessions, main flushes state as today, holds the quit (`preventDefault`), kills every session (D1) and quits again once all of them have exited, or at the latest **3,000 ms** after the hold (grace period + 1 s), whichever comes first. A later `before-quit` (the one main triggers itself, or another quit request while waiting) doesn't hold again: it SIGKILLs any shell still alive, synchronously, before letting the quit through. No new dialog or UI; the window stays as it is during the at most 3 s wait. *Why:* the escalation timer of D1 can't fire in a process that already exited; a bounded wait plus a synchronous SIGKILL as last resort guarantees no shell outlives the app without risking a hung quit.
- **D3 – Scope is the shell process:** escalation targets the shell pid node-pty spawned (the session leader of the card's PTY), as SIGHUP does today. Its jobs get the hangup from the shell or, once the session leader dies, from the kernel; no process-group or tree killing. *Why:* matches today's behaviour and the item's ask ("shell pids are gone").

## Acceptance criteria

- **AC1 – Escalation:** Given a session whose shell is `/bin/sh` running `trap '' HUP`, when it is killed, then it is still alive after 500 ms, and within 4 s its exit is reported (signal 9) and the pid is gone. Given an ordinary shell, when killed, its exit arrives as before and no SIGKILL is sent (exit signal is not 9). (Vitest, `SessionManager`.)
- **AC2 – killAll resolves when every shell is gone:** Given three sessions, one ignoring SIGHUP, when `killAll()` is awaited, then it resolves within 4 s with no session left and every pid gone; with no sessions it resolves at once. (Vitest, `SessionManager`.)
- **AC3 – No shell survives quitting the app:** Given the running app with two shells spawned through the bridge, one of which ran `trap '' HUP`, when `app.close()` resolves, then within 2 s neither shell pid exists. (Playwright-Electron, `e2e/lifecycle.spec.ts`.)
- **AC4 – Closing a card escalates:** Given a running card whose shell ran `trap '' HUP`, when the card is closed through the bridge's `kill`, then its pid is gone within 4 s and the session's exit reaches the renderer. (Playwright-Electron, `e2e/lifecycle.spec.ts`.)

## Slices

1. **S1 – Escalating kill and a waiting quit:** `SessionManager.kill` escalates (D1); `killAll()` returns a promise that resolves once every session has exited, plus a synchronous force-kill of whatever is left; `Terminals` exposes both and the session count; main's `before-quit` holds the quit as in D2. Unit tests for AC1 and AC2, e2e tests for AC3 and AC4. Satisfies AC1–AC4.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest `src/core/session-manager.test.ts` | — |
| AC2 | Vitest `src/core/session-manager.test.ts` | — |
| AC3 | e2e `e2e/lifecycle.spec.ts` | launch, spawn a shell with `trap '' HUP` and one without, `app.close()`, check both pids |
| AC4 | e2e `e2e/lifecycle.spec.ts` | launch, spawn a shell with `trap '' HUP`, `terminal.kill`, poll its pid and wait for the exit event |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Killing a shell's whole process group or descendants that detached from the PTY (`setsid`, daemons).
- Any UI for a slow quit or a stubborn shell.
- Remote processes behind an SSH card (#12): only the local `ssh` process is killed.

## Open questions

None.
