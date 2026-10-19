---
item: 51
type: feature
title: 'Global hotkey'
status: approved
branch: claude/51-global-hotkey
---

# Global hotkey

## Problem

When an agent waits for the user, they are usually in another app (an editor, a browser) and have to find Drovr's window first. After this ships, the user can set one system-wide shortcut in Settings that brings Drovr to the front from any app, straight onto the card that has waited longest (#41's Next waiting card), and pressing it again while Drovr is focused hides it again. It is off until the user records one. The drop-down "quick terminal" from the idea is left for a later item.

## Domain decisions

- **D1 – Scope:** one **global shortcut**, registered with the OS through Electron's `globalShortcut` in main, that shows or hides Drovr. No quick terminal window, no second global shortcut. *Why:* full auto chose bring-to-front only: it covers "one keypress from any app"; a quick terminal is a second window with its own sessions and focus handling (medium) and can be its own item.
- **D2 – Off by default:** no global shortcut is registered until the user records one; clearing it unregisters it at once. *Why:* full auto chose none: a global key takes that combination from every other app, and iTerm2 and Ghostty ship theirs unset too.
- **D3 – What a press does:** when Drovr's window is focused (visible, not minimized, `isFocused()`), it hides: on macOS `app.hide()` (focus goes back to the previous app), elsewhere the window is minimized (Drovr has no tray icon, so the taskbar entry stays). Otherwise (another app is in front, the window is behind another, minimized, or hidden) it is restored, shown and focused, as `second-instance` already does, and then D4 applies. With no window (macOS after closing it) a new one is created. A held key's auto-repeat is up to the OS; each press toggles once. *Why:* full auto chose a toggle, which is what hotkey windows do.
- **D4 – Next waiting card on show:** when a press brings Drovr forward (not when it hides it) and the **Open the next waiting card** switch is on (default on), main tells the renderer (`app:globalShow`), which runs exactly what the Next waiting card shortcut runs (#41 D4, D5): the longest-waiting card or shell opens at full size in its workspace; nothing happens when nothing waits, when only the open card waits, or while a dialog is open (`[aria-modal="true"]`, Settings and the palette included). With the switch off only the window comes forward, with whatever view it had. *Why:* full auto chose this: answering an agent in one keypress is the item's point, and reusing #41 opens exactly what the in-app shortcut would.
- **D5 – Setting it:** Settings' Shortcuts section gets a **Global** group above the in-app shortcuts: a row **Show or hide Drovr (from any app)** with a field showing the shortcut (`ShortcutKeys`) or `None`, recorded like the others (#31 D8: click, press, Escape cancels; a key without Cmd, Ctrl or Alt refused with the same message; a fixed shortcut or any in-app action's shortcut refused with `Already used by <name>`), a **Clear** button instead of Reset (disabled while `None`), and under it the switch **Open the next waiting card**. Recording an in-app action refuses the global shortcut with `Already used by Show or hide Drovr`. A key Electron can't register globally (D7 has no accelerator for it) is refused with `Can't be a global shortcut`. A new shortcut or Clear applies and saves at once. *Why:* full auto chose to reuse #31's recorder and text; one key never means two things, so an in-app action never becomes unreachable.
- **D6 – Recording suspends it:** while any shortcut field in Settings records, main unregisters the global shortcut (and registers it again when recording ends, the dialog closes or the window loses focus), so pressing it during recording reaches the recorder (and is refused or kept) instead of hiding the window.
- **D7 – Accelerator:** the stored text is #31's D7 text; main turns it into an Electron accelerator with a pure function in `src/core`: `Ctrl` → `Control`, `Alt` → `Alt`, `Shift` → `Shift`, `Cmd` → `Command` on macOS and `Super` elsewhere; keys: letters, digits and `F1`–`F24` as they are, `ArrowUp/Down/Left/Right` → `Up/Down/Left/Right`, `Enter`, `Space`, `Tab`, `Backspace`, `Delete`, `Escape` → `Esc`, `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `+` → `Plus`, and the other printable ASCII punctuation as is; anything else has none (refused by D5, dropped when read by D9).
- **D8 – When the OS refuses it:** main registers at launch (once ready), after each settings save that changes the global shortcut, and after recording ends (D6). When `globalShortcut.register` returns false (another app holds it, or the desktop doesn't allow global shortcuts, e.g. Wayland without the portal), the shortcut stays saved and the row shows `Couldn't register this shortcut: another app may use it, or the desktop doesn't allow global shortcuts` under it; it is tried again at the next launch and save. The renderer reads the state (`none`, `registered`, `failed`) from main when Settings opens and after each save. On Linux main enables Chromium's `GlobalShortcutsPortal` feature at startup, merged into any `enable-features` already set, so a Wayland desktop with the portal can grant it. *Why:* full auto chose to keep it: the other app may quit later, and the user sees why it does nothing. Electron may report success where X11 silently loses a grab: then nothing shows, which is the OS's limit.
- **D9 – Saved:** `drovr-settings.json` gains `globalShortcut` (D7 text, written only when set) and the preference `openWaitingOnShow` (default `true`, written only when `false`, through the Preferences table). Reading: a `globalShortcut` that isn't shortcut text with Cmd, Ctrl or Alt, is fixed, has no accelerator (D7) or equals an in-app action's resolved shortcut is dropped (none) and reported like other replaced fields; saving refuses such a value. Kept per machine like every setting, never in the Sync folder.
- **D10 – Nothing else changes:** in-app shortcuts, Next waiting card, notifications and `second-instance` behave as before. Quitting unregisters every global shortcut (`will-quit`).

## Acceptance criteria

- **AC1 – Off by default:** Given a fresh data directory, when the app launches, then main has no global shortcut registered (`globalShortcut.isRegistered` false for the platform's candidates used in the tests) and Settings > Shortcuts shows the Global row reading `None` with Clear disabled and Open the next waiting card on.
- **AC2 – Record and register:** Given Settings > Shortcuts, when the user clicks the Global field and presses `Ctrl+Alt+Shift+D` (Linux), then the field shows it, `drovr-settings.json` holds `"globalShortcut": "Ctrl+Alt+Shift+D"`, and main reports `globalShortcut.isRegistered('Control+Alt+Shift+D')` true; after a restart it is still registered; Clear makes the field `None`, removes the key from the file and unregisters it.
- **AC3 – Refusals:** Given the Global field recording, when the user presses `D` alone the row shows `Use Ctrl or Alt with a key`; `Ctrl+Shift+P` shows `Already used by Command palette`; `Ctrl+Shift+C` shows `Already used by Copy`; and with the global shortcut `Ctrl+Alt+Shift+D` set, recording Split right with `Ctrl+Alt+Shift+D` shows `Already used by Show or hide Drovr`.
- **AC4 – Bring forward and hide:** Given the global shortcut set and the window minimized (or not focused), when it is pressed (the development build's test hook calls main's handler), then the window is visible, not minimized and focused; pressed again while focused, the window is minimized off macOS (hidden with `app.hide()` on macOS).
- **AC5 – Next waiting card:** Given workspaces `Alpha` (active, on its board) and `Beta` with a running card `one` that ran `board activity . waiting`, and the window minimized, when the global shortcut is pressed, then the window is focused, `Beta` is active and `one` is open at full size; with Open the next waiting card off, the same press leaves `Alpha`'s board showing; with nothing waiting, the board stays as it was.
- **AC6 – Recording suspends:** Given the global shortcut set, when the Global field (or any shortcut field) starts recording, then main reports it not registered, and when recording ends (a new shortcut, Escape or closing Settings) it is registered again.
- **AC7 – Refused by the OS:** Given main's register fails for the saved shortcut (unit: an injected `register` returning false; e2e not possible), then the state is `failed`, the Settings row shows `Couldn't register this shortcut: another app may use it, or the desktop doesn't allow global shortcuts`, the file keeps the shortcut, and a later save that changes it tries again.
- **AC8 – Bad files:** Given `drovr-settings.json` with `"globalShortcut": "D"`, or `"Ctrl+Shift+P"` (the palette's), or `42`, when the app launches, then no global shortcut is registered and the row reads `None`; `"openWaitingOnShow": "no"` reads as on.
- **AC9 – Accelerators:** unit: `Ctrl+Alt+Shift+D` → `Control+Alt+Shift+D`; `Cmd+Shift+Space` → `Command+Shift+Space` on darwin and `Super+Shift+Space` on linux; `Ctrl+ArrowUp` → `Control+Up`; `Alt+Escape` → `Alt+Esc`; `Ctrl++` → `Control+Plus`; `Ctrl+F5` → `Control+F5`; a named key outside D7's list has none.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Saved setting and accelerator:** `globalShortcut` and `openWaitingOnShow` in the settings file (read, validate, write, D9), the D7 accelerator function and the in-app recorder refusing the global shortcut; unit tests. Satisfies AC9, AC8 (file side), AC3 (last case, unit).
2. **S2 – Registration in main:** a main-side controller (core logic with `register`/`unregister` injected, `src/main` wiring) registering at launch, on settings save and unregistering at quit, reporting `none`/`registered`/`failed` over IPC, the D3 toggle with the development build's test hook, `app:globalShow` and the renderer opening the next waiting card (D4), the Linux portal switch; Vitest for the controller and toggle decision, e2e for AC4, AC5, AC8. Satisfies AC4, AC5, AC7, AC8.
3. **S3 – Settings row:** the Global group in Settings' Shortcuts section (record, refusals, Clear, the switch, the failure line) and suspending while recording (D6); e2e in `e2e/settings.spec.ts` or a new `e2e/global-hotkey.spec.ts`. Satisfies AC1, AC2, AC3, AC6, AC7 (row).

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e (`electronApp.evaluate` reading `globalShortcut.isRegistered`) | Fresh launch, open Settings > Shortcuts, see `None` |
| AC2 | e2e | Record `Ctrl+Alt+Shift+D`, read the file and `isRegistered`, restart, Clear |
| AC3 | Vitest (recorder) + e2e | Press the refused keys in the Global field |
| AC4 | e2e through the development build's hook calling main's handler (xvfb can't send OS-wide keys) | Minimize, call the hook, check `isFocused`/`isMinimized`; call again |
| AC5 | e2e | Waiting card in `Beta`, minimize, call the hook |
| AC6 | e2e | Start recording, read `isRegistered`, Escape, read again |
| AC7 | Vitest (controller with a refusing `register`) | — |
| AC8 | Vitest (settings file) + e2e (written file) | Write the file, launch, read the row |
| AC9 | Vitest | — |

## Stack changes

None. `globalShortcut` is part of Electron.

## Data and migrations

`drovr-settings.json` gains `globalShortcut` (absent = none) and `openWaitingOnShow` (absent = true). Older files load unchanged.

## Out of scope

- The drop-down quick terminal window (Ghostty's quick terminal, Guake) and a tray icon.
- A second global shortcut for other actions.
- Making the global shortcut work where the OS refuses it (Wayland without the portal, keys another app grabs).
- Syncing the setting between machines.

## Open questions

None.
