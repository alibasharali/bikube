---
item: 66
type: chore
title: Polishes
status: approved
branch: claude/66-polishes
---

# Polishes

## Problem

Three rough edges. The New shell shortcut (Cmd+T on macOS, Ctrl+Shift+T elsewhere) only ever opens the workspace's Default shell, so once that runs there is no quick way to get another plain shell. Settings' Appearance section holds the terminal's font settings (size, family, weight, line height, letter spacing), which belong with the terminal, and the Terminal section's preview ignores most of them; the app's own font can't be changed at all. And the main window always opens at 1100×720, however it was left. After this item the shortcut opens a fresh numbered shell once the Default shell runs, the terminal font settings live in Terminal with a preview that follows them, Appearance has an App font, and the main window opens where and as large as it was closed.

## Domain decisions

- **D1 – The shortcut's two cases:** in the active workspace, while its Default shell is not running the shortcut (and its palette row) opens and starts the Default shell, as today. While the Default shell runs, whether it is the open view or not, it adds a new plain shell to the workspace and opens it at full size, started. No active workspace: nothing. Works for SSH workspaces too (a plain shell over SSH, as the Default shell). *Why:* the item.
- **D2 – New shells are temporary:** a shell the shortcut adds is a named shell of type `shell` with no command and no autostart, marked temporary. It shows in the Shells tab, the sidebar tree and the palette like any shell, and is removed from the workspace as soon as it stops (its shell exits, Close, Stop, or a workspace delete). It is never written to the state file or the Sync folder's board file, so nothing of it survives a restart or reaches another machine; a sync apply keeps this machine's temporary shells (as it keeps `runIn`). *Why:* the item asks for terminal-tab behaviour; stored shells would pile up `Terminal 1…n` in every workspace and on every synced machine. Rejected: persisted shells the user deletes by hand.
- **D3 – Names:** `Terminal N`, N the lowest positive integer such that no shell of the workspace (temporary or named) is called `Terminal N`. So the first is `Terminal 1`, then `Terminal 2`; once `Terminal 1` stops, the next is `Terminal 1` again. *Why:* the item's "Terminal 1, then 2"; reuse matches terminal tabs.
- **D4 – The shortcut's label:** the action keeps its id `openShell` and its default keys, and its label (Settings > Shortcuts and the palette row) becomes `New shell`. *Why:* it no longer only opens the Default shell; keeping the id keeps saved overrides.
- **D5 – Terminal font settings move:** Font size, Font family (with Custom…), Font weight, Line height and Letter spacing move from Appearance to the Terminal section, unchanged in behaviour, test ids and saved keys, placed above the Preview. Appearance keeps Theme and App theme and gains App font (D7). *Why:* the item; they only change terminals.
- **D6 – The preview follows them:** the Terminal section's preview draws with the terminal's font family, size, weight (bold runs stay bold), line height (as a multiple of the font size) and letter spacing (px), and redraws at once when any of them changes. *Why:* the item.
- **D7 – App font:** a new preference `appFontFamily` in `bikube-settings.json`, `''` meaning the default (today's system UI stack, `--font-ui`), written only when not default like the other preferences. Appearance's App font row is a select: `System (default)`, the installed fonts from a fixed list of common UI fonts (such as Inter, SF Pro Text, Helvetica Neue, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Open Sans, Source Sans 3, IBM Plex Sans, Arial; the saved one shown `(not installed)` when missing, as Font family does), and `Custom…` with a text field applied on blur or Enter, checked like Font family (trimmed, at most 200 characters, no control characters; empty is the default). A font is saved as `"<name>", <today's UI stack>`, so missing glyphs fall back to the system font. It sets the chrome's UI font (everything drawn with `--font-ui`: board, sidebar, side panel, title bar, menus, palette, Settings and other dialogs) in the main page and every card window, at once on change; text that uses the monospace stack (`--font-mono`: card ids, paths, code-like chips) and the terminals don't change. *Why:* the item; the mono stack is deliberately monospace.
- **D8 – Window state:** main keeps the main window's last normal bounds (x, y, width, height) and whether it was maximized or full screen in `<userData>/bikube-window.json` (`{ "version": 1, "bounds": {…}, "maximized": bool, "fullScreen": bool }`), this machine's only, never synced. It is written when the window closes and, debounced (about 500 ms), after a move or resize, so a crash or SIGKILL keeps the last state. At launch the saved bounds are used when at least 100×50 px of them lies within some display's work area and the size is at least the window's minimum (320×240, so the app still reaches the 320 px width its UX checks use; smaller sizes are raised to it); otherwise, or when the file is missing or invalid, the window opens at today's 1100×720, centred. A saved maximized or full-screen window opens that way, with the saved bounds as its normal size. Card windows (#53) keep today's behaviour. *Why:* the item; the display check keeps a window from opening off-screen after a monitor is unplugged.

## Acceptance criteria

- **AC1 – Default shell first:** Given a workspace whose Default shell is not running, when the user presses the New shell shortcut, then the Default shell opens at full size, running, and the workspace has no shell named `Terminal 1`.
- **AC2 – New shell while Default runs and is shown:** Given the Default shell is running and open, when the user presses the shortcut, then a shell `Terminal 1` opens at full size, running, listed in the Shells tab and in the sidebar tree under the workspace; pressing it again opens `Terminal 2`.
- **AC3 – New shell while Default runs elsewhere:** Given the Default shell is running but the board (or a card) is shown, when the user presses the shortcut, then `Terminal 1` opens, not the Default shell.
- **AC4 – Temporary:** Given `Terminal 1` and `Terminal 2` are running, when `exit` is typed in `Terminal 1`, then it disappears from the Shells tab and the sidebar, and the next press opens `Terminal 1`; and after a restart neither is listed, `bikube-state.json` never named them, and with a Sync folder on, the folder's board file never named them.
- **AC5 – Label:** Settings > Shortcuts lists the action as `New shell` and the palette's row reads `New shell`, running D1.
- **AC6 – Settings layout:** Given Settings is open, then Appearance shows Theme, App theme and App font and no terminal font rows, and Terminal shows Font size, Font family, Font weight, Line height and Letter spacing (same test ids as before) above the Preview; each still saves and applies to terminals as before.
- **AC7 – Preview follows:** Given the Terminal section, when Font size is set to 18, Font weight to Semibold, Line height to 1.5 and Letter spacing to 2 px, then the preview's computed style has font-size 18 px, font-weight 600, line-height 27 px and letter-spacing 2 px; and picking another installed font family changes its font-family.
- **AC8 – App font:** Given Appearance, when App font is set to Custom `Courier New`, then the sidebar, board columns and the Settings dialog compute a font-family starting with `"Courier New"` in the main page and in an open card window, terminals keep the terminal font, and `bikube-settings.json` holds `"appFontFamily"`; after a restart it still applies; choosing `System (default)` removes the key and restores the system stack.
- **AC9 – Window size remembered:** Given the main window is set to 900×650 at (60, 40) and the app quits, when it launches with the same data directory, then the window's bounds are 900×650 at (60, 40); a window maximized at quit opens maximized.
- **AC10 – Off-screen or bad file:** Given `bikube-window.json` holds bounds entirely outside every display, or invalid JSON, when the app launches, then the window opens at 1100×720, centred on the primary display, and the app runs normally.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Window state:** a plain-TS module for the window file (parse, validate, fit against displays' work areas, the minimum size), Vitest-covered; main reads it before creating the window, restores maximized/full screen, and saves on close and debounced on move/resize. Satisfies AC9, AC10.
2. **S2 – Terminal font settings in Terminal:** move the five rows from Appearance into the Terminal section above the Preview; the preview takes weight, line height and letter spacing; update the e2e tests that open Appearance for font rows. Satisfies AC6, AC7.
3. **S3 – App font:** the `appFontFamily` preference (default, checks, file), the UI font list and the App font row, and the renderer applying it to `--font-ui` in the main page and each card window. Satisfies AC8.
4. **S4 – New shell:** temporary shells in the workspace store (added with the D3 name, removed on stop, excluded from the state file and sync file, kept by sync apply), the shortcut and palette row per D1 and the `New shell` label. Satisfies AC1–AC5.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC4 | Vitest for the name rule, the store's temporary shells and their exclusion from state/sync serialisation and sync apply; e2e in `e2e/shells.spec.ts` | Press Cmd+T / Ctrl+Shift+T on the board, again, again from the board, `exit` in Terminal 1, restart |
| AC5 | e2e `e2e/palette.spec.ts`, `e2e/settings.spec.ts` | Open the palette and Settings > Shortcuts |
| AC6, AC7 | e2e `e2e/settings.spec.ts` | Settings > Terminal: change the rows, read the preview's computed style |
| AC8 | Vitest for the preference check; e2e `e2e/settings.spec.ts` (card window in `e2e/card-windows.spec.ts` or the same test) | Settings > Appearance > App font Custom `Courier New`, read computed font-family |
| AC9, AC10 | Vitest for the window-state module; e2e `e2e/persistence.spec.ts` with `setBounds` through `app.evaluate`, quit, relaunch | Resize and move the window, quit, relaunch |

## Stack changes

None.

## Data and migrations

- `bikube-settings.json`: new optional `appFontFamily` preference; absent means default, so every existing file reads as today.
- New `<userData>/bikube-window.json` (D8); missing means today's default size.
- Workspace shells gain an optional runtime-only `temporary: true` flag; never in `bikube-state.json` or the sync file, so existing files are unchanged.

## Out of scope

- Applying the App font before the first paint (it may switch from the system font once settings are read); changing the app's text size.
- Remembering card windows' sizes or positions.
- Renaming, reordering or keeping a temporary shell; a "keep this shell" action.
- Changing the theme picker's own preview.

## Open questions

None.
