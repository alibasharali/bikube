---
item: 46
type: feature
title: Keep a card's scrollback across restarts
status: approved
branch: claude/46-keep-card-scrollback
---

# Keep a card's scrollback across restarts

## Problem

Today a Stopped card's screen and scrollback are gone (CONTEXT.md: Stopped): when an agent exits, the user Closes the card, or the app quits, the previous run's output is lost, and reopening the card starts on an empty screen. After this ships, each card's main pane output is saved on this machine whenever its shell stops and when the app quits, and opening the card again shows that output in the new screen's scrollback, above a dim separator line, with the new session continuing below. A Settings switch turns it off. Nothing of it is synced.

## Domain decisions

- **D1 – What is kept:** the main pane of a card (never an extra pane, the Default shell or a named shell). Its normal buffer's scrollback and visible screen, with colours and text attributes, serialized by `@xterm/addon-serialize` without terminal modes, without the alternate screen (`excludeModes`, `excludeAltBuffer`), and as the range of rows ending at the last row with text (the addon's `range`, which leaves out the final cursor moves and the screen's trailing blank rows), so the separator starts below the last old line wherever the old cursor was (an agent's input box above its footer). *Why:* the item is about agent runs; extra panes are discarded by design (#11) and the Default shell isn't stored. Restoring modes or a full-screen app's frame would leave the new shell broken (mouse reporting, a vim frame).
- **D2 – When it is saved:** every time a card's main pane shell stops and the card turns Stopped (it exits, is Closed, or `SSH failed`), read once the screen has parsed everything written to it and before the screen is discarded; and for every running card when the app starts quitting (`app:quitting`), before main stops the shells. Not for `Couldn't start`, and not when a card is deleted. A save replaces the card's previous save. *Why:* every stop loses output today, not only a quit; one rule is simplest. The quit save is taken at `app:quitting` because the window may be gone before the quit's hangups end every shell; the stops that follow during the quit hold save again if they still reach main, which only adds the last lines. Main's quit waits for the renderer to answer that its quit saves are sent (at most 1 s, inside the existing quit hold limit) before it stops the shells, since the hangups end most shells within milliseconds.
- **D3 – Size cap:** a save holds at most the last rows up to the **Scrollback** setting (10,000 by default) plus the screen, and at most 1,000,000 characters of serialized data: when the serialized text is longer, the renderer serializes again with half the scrollback rows, until it fits (0 rows, the screen alone, always counts as fitting; if even that is too long it is cut to its last 1,000,000 characters at a line break). Main refuses anything longer. *Why:* size-capped as the item asks; the total is bounded by the board's cards.
- **D4 – Where it is kept:** main writes each save to `<userData>/scrollback/<sha256 of the card id, hex>` (the directory created 0700, files 0600, written to a temporary file and renamed), never to the state file and never to the Sync folder. Main is the only one touching the files; the renderer only names a card id. Only the window's main frame may read, save or delete (as `state:*`). *Why:* scrollback can hold secrets; hashing the id keeps any id a safe file name.
- **D5 – How it is shown:** when a card starts (any start: opening it, restart, Retry), the renderer reads its save before spawning the shell, and if there is one writes it into the new screen, then resets the attributes (`ESC [0m`), moves to a fresh line and writes a dim separator line `── Previous output · <ended> ──`, where `<ended>` is the save's time in the user's locale (date and time, e.g. `19 Oct 2026, 14:32`), then CRLF. The shell then spawns, and its output follows below. The spawn waits for the read (an IPC round trip); a failed or missing read restores nothing and the card starts as today. The restored lines are plain output above the prompt: scrolling and Find reach them, typing never does. *Why:* matches the item's "read-only above the new session" and iTerm2/Windows Terminal without a new view; the separator says where the old run ended.
- **D5a – The new session's status:** the card's status reads only the rows below the separator for its last output line, so `SSH failed: <line>` (#12 D7) names this session's output, empty when ssh printed nothing, never a restored line or the separator.
- **D6 – Accumulating history:** a save is not removed when it is shown, so a crash during the next run still finds it. The next stop's save includes the restored lines above the new output, so history accumulates up to D3's cap.
- **D7 – Removed:** a card's save is removed when the card is deleted (by the user, by deleting its workspace, or by sync removing it); at launch, main removes every save whose card id is not a card on the board it loads; and every save is removed when the switch (D8) is turned off. *Why:* nothing is left behind for cards that are gone.
- **D8 – The switch:** a preference `keepOutput` (Settings > Terminal: **Keep output after a card stops**), on by default, written to `drovr-settings.json` only when off, like the other preferences. Off: nothing is saved, nothing is restored, and turning it off deletes every save. Turning it back on starts saving from the next stop. *Why:* scrollback can hold secrets, and Claude Code's resume reprints its conversation, so some users will want it off.
- **D9 – Status line:** the board's last-output line, like D5a, reads only the new session's rows: until the shell prints it is empty, as on a fresh start.
- **D10 – CONTEXT.md:** Stopped changes: "its process is gone; its output stays on this machine (unless Keep output is off) and is shown above the next start's output". Saved state's "Not … screens or scrollback" stays true for the state file; a new term **Kept output** describes D1–D8. Sync folder: kept output is never synced.

## Acceptance criteria

- **AC1 – Shown after a Close:** Given a running plain card (Custom `:`) in which the user runs `echo kept-46-close`, when the user Closes it, then opens it again, then the new screen shows `kept-46-close` above a line starting `── Previous output ·`, and the new prompt below it accepts `echo after` with its output below the separator.
- **AC2 – Shown after a restart:** Given a running card in which the user ran `echo kept-46-quit`, when the app quits and launches again and the user opens the card, then `kept-46-quit` is above the separator line.
- **AC3 – Shown after the shell exits by itself:** Given a running card where the user types `echo kept-46-exit; exit`, when the card turns Stopped and is opened again, then `kept-46-exit` is above the separator.
- **AC4 – Accumulates:** Given AC1's card after its reopen and `echo second-run`, when it is Closed and opened again, then both `kept-46-close` and `second-run` are above the newest separator, in that order.
- **AC5 – Colours kept, modes not:** Given a card that printed `printf '\e[31mred\e[0m\n'` and turned on mouse reporting (`printf '\e[?1000h'`), when it is Closed and reopened, then the restored `red` cell has foreground colour 1 and the new screen's mouse tracking is off.
- **AC6 – Removed with the card:** Given a card with a save, when the card is deleted, then its file under `<userData>/scrollback` is gone. Given a save file for a card id not on the board, when the app launches, then the file is removed.
- **AC7 – The switch:** Given a card with a save, when the user turns off **Keep output after a card stops** in Settings, then the `scrollback` folder holds no files, the next Close saves nothing and the reopened card shows no separator; `drovr-settings.json` holds `"keepOutput": false`, kept across a restart.
- **AC8 – Size cap:** Given a screen whose serialized scrollback exceeds 1,000,000 characters, the save is at most 1,000,000 characters and keeps the newest rows (Vitest, the trimming rule). Main refuses a save longer than that (Vitest).
- **AC9 – Only cards' main panes:** Given a card with an extra pane and the Default shell, when each is stopped and started again, then neither shows a separator line, and the `scrollback` folder holds one file only (for the card).
- **AC10 – Files:** the scrollback folder is mode 0700 and each file 0600; nothing of it appears in the Sync folder's `drovr-board.json` or in `drovr-state.json`.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Save on stop, restore on start:** `@xterm/addon-serialize` (0.14.0, released with xterm 6.0.0) in `XtermScreen`; the trimming rule (D3) as plain core code; `CardScreen` gains a serialize call; `CardSessions` takes an injected keeper (read before spawn, save on stop, D2, D5) used only for cards (not shells, not panes); main's scrollback store (D4, D7 at delete) with IPC `scrollback:read`, `scrollback:save`, `scrollback:delete` through the preload; the separator line; the card is deleted → its save removed. Unit tests for the trim rule, the store (hashing, modes, refusal of oversize, atomic write) and `CardSessions` with a fake keeper; e2e `e2e/kept-output.spec.ts` for AC1, AC3, AC4, AC5, AC6 (delete), AC9, AC10. Satisfies AC1, AC3–AC6 (delete), AC8–AC10.
2. **S2 – Quit and launch:** the renderer saves every running card's main pane on `app:quitting` (D2); main removes saves of cards not on the loaded board at launch (D7). E2E for AC2 and AC6 (launch prune), plus AC10's state and sync files. Satisfies AC2, AC6.
3. **S3 – The switch and docs:** the `keepOutput` preference with Settings' switch (D8), deleting every save when turned off; CONTEXT.md (D10) and AGENTS.md's test list and architecture line. E2E for AC7. Satisfies AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `kept-output.spec.ts`; Vitest `card-sessions` with a fake keeper | Card, `echo kept-46-close`, Close, open: text above `── Previous output ·` |
| AC2 | e2e `kept-output.spec.ts` (relaunch on the same data dir) | `echo kept-46-quit`, quit, launch, open card |
| AC3 | e2e | `echo kept-46-exit; exit`, open again |
| AC4 | e2e | Close twice, both lines above the newest separator |
| AC5 | e2e reading the buffer cell's colour and `term.modes.mouseTrackingMode` | as AC |
| AC6 | e2e (file gone after delete; planted file gone after launch) | delete a card, list `<userData>/scrollback` |
| AC7 | e2e (Settings switch, settings file, restart) | toggle the switch, Close, open |
| AC8 | Vitest (trim rule; main store refusing oversize) | — |
| AC9 | e2e (split pane and Default shell restarted) | as AC |
| AC10 | e2e (`fs.stat` modes; state and sync files' text) | `ls -la <userData>/scrollback` |

## Stack changes

None. `@xterm/addon-serialize` is an addon of xterm.js, already in the stack (ADR 0001), at the version released with the xterm 6.0.0 in use.

## Data and migrations

New folder `<userData>/scrollback/` with one file per card that has a save; created on first save. New preference `keepOutput` (default true, absent from older settings files, which read as on). The state file and the sync file are unchanged.

## Out of scope

- Extra panes, the Default shell and named shells.
- A command or menu item to clear one card's kept output (turning the switch off clears all).
- Syncing kept output between machines; restoring on another machine.
- Restoring the alternate screen, terminal modes, cursor position or the old process.

## Open questions

None.
