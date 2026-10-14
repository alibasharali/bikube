---
item: 10
type: feature
title: Themes and settings
status: approved
branch: claude/10-themes-settings
---

# Themes and settings

## Problem

Drovr has one look: a fixed dark palette, and terminals in 13 px Menlo. Someone who works in a light macOS appearance, needs bigger text, or prefers another monospace font has no way to change it. The product lists "themes and settings beyond the basics" as the step after v1, which is now merged (#2–#9). After this ships, a Settings dialog sets the colour theme (System, Dark, Light) and the terminal font size and family; changes apply at once to the board and every terminal and are kept across restarts.

## Domain decisions

- **D1 – Settings:** three app-wide settings, the same for every workspace and card: `theme` (`system` | `dark` | `light`, default `system`), `fontSize` (integer 8–32, default 13), `fontFamily` (text, default `Menlo, Consolas, monospace`). *Why:* round 1 Q1, Q2, Q7; cursor style, scrollback length and custom colours are left for later items.
- **D2 – Theme:** `dark` is today's palette, unchanged. `light` is a new palette with the same tokens (at least `--bg #f6f7f9`, `--surface #ffffff`, `--surface-hover #eceef2`, `--border #d9dce3`, `--text #1b1d24`, `--text-muted #5d6170`, `--accent #3d63dd`, `--accent-text #ffffff`, `--danger #d1343a`). `system` follows the OS appearance and switches live when it changes. Main sets Electron's `nativeTheme.themeSource` from the setting (`system`/`dark`/`light`), and the window's CSS picks the palette from `prefers-color-scheme`, so one rule covers every view and dialog. The window's background colour at creation matches the resolved theme, so a light launch doesn't flash dark. *Why:* round 1 Q2; `nativeTheme` keeps native parts (scrollbars, form controls, the macOS title bar) in step with the page.
- **D3 – Terminal colours:** every terminal uses the palette of the resolved theme: background, foreground, cursor, selection and the 16 ANSI colours. Dark: background `#14151a`, foreground `#e6e7eb`. Light: background `#ffffff`, foreground `#1b1d24`, with ANSI colours readable on white (yellow and bright white darkened). Both palettes live in one plain core module. A theme change, including an OS appearance change under `system`, recolours every terminal at once, running or not, without touching its process or scrollback. *Why:* round 1 Q3.
- **D4 – Terminal font:** every terminal uses `fontSize` and `fontFamily`. A change applies at once to every terminal; the open one refits, and its new columns and rows go to its PTY as a resize (like a window resize), so the shell redraws. Cards on the board refit when next opened. An empty or whitespace-only family means the default. A family naming a font that isn't installed falls back as CSS does; Drovr doesn't check installed fonts. *Why:* round 1 Q6, Q7.
- **D5 – Settings dialog:** a `Settings` button at the bottom of the sidebar (a gear icon with label `Settings` when expanded; the icon with `aria-label="Settings"` when collapsed) and `Cmd+,` on macOS / `Ctrl+,` elsewhere open a modal titled `Settings`, from the board or the full-size card view. It shows: Theme (radio group `System`, `Dark`, `Light`), Font size (a text field for typed digits, so any text can be typed and checked), Font family (text field of at most 200 characters, placeholder `Menlo, Consolas, monospace`), and a `Done` button. Every valid change applies at once (round 1 Q6); `Done`, `Escape` or a click outside closes the dialog and keeps what was applied. A font size that isn't a whole number from 8 to 32 shows `Font size must be a whole number from 8 to 32` under the field and isn't applied; the last valid size stays in effect, and closing the dialog drops the invalid text. The font family is applied as typed (trimmed) once the field loses focus or Enter is pressed, and also when the dialog closes any way (`Done`, `Escape`, a click outside). The shortcut does nothing while another dialog is open, and it reaches the app even when a terminal has focus (the terminal doesn't receive it). *Why:* round 1 Q5, Q6; reuses `Modal`; `Cmd+,` is the macOS convention. Round 3 (ship review): apply the family on every close, cap it at 200 characters, a text field for the size so `abc` and `12.5` reach the error.
- **D6 – Settings file:** main keeps settings in `drovr-settings.json` in `userData` (so `DROVR_USER_DATA_DIR` gives each test its own), as `{"version":1,"settings":{"theme":…,"fontSize":…,"fontFamily":…}}`, apart from the board's `drovr-state.json` (#8), whose format doesn't change. Main loads it at startup before creating the window (D2's background). The renderer gets main's settings over a new `settings:load` IPC and sends each change over `settings:save`; main validates it, ignores anything invalid, applies `themeSource`, and writes atomically (temp file, fsync, rename) within 200 ms, flushing on quit, like the state file. Only a window's own top-level frame may load or save. *Why:* round 1 Q4: the board's saved-state rules stay untouched; settings aren't board data.
- **D7 – Missing or invalid file:** a missing file means all defaults, and nothing is written until a setting changes. A file that isn't JSON, isn't an object, or has another `version` means all defaults. Otherwise each field is checked on its own (D1's types and ranges; `fontFamily` a string of at most 200 chars with no control characters, trimmed): an invalid or missing field takes its default and the valid ones are kept. Main logs what it replaced. The file is rewritten in full on the next change; it is never renamed aside. *Why:* round 1 Q8: settings are cheap to redo, and the board is never at risk.

## Acceptance criteria

Fresh data directory unless stated otherwise; workspace `alpha` (`/tmp/drovr-alpha`) with a running card `api`.

- **AC1 – Defaults:** Given no `drovr-settings.json`, when Drovr starts with the OS in dark appearance, then the board's background is `#14151a` (today's look), `api`'s terminal is 13 px `Menlo, Consolas, monospace` with background `#14151a`, and no `drovr-settings.json` has been written.
- **AC2 – Open and close Settings:** Given the board, when the user clicks `Settings` at the bottom of the sidebar (expanded or collapsed), then a modal titled `Settings` shows Theme `System` selected, Font size `13`, an empty Font family, and `Done`; `Done`, `Escape` and a click outside each close it. `Cmd+,` (macOS) / `Ctrl+,` (Linux) opens it from the board and from `api`'s full-size view while the terminal has focus, and the terminal receives no input from the key; with the workspace dialog open, the shortcut does nothing.
- **AC3 – Light theme:** Given Settings open, when the user picks `Light`, then without closing the dialog the board's background is `#f6f7f9`, the sidebar's `#ffffff`, text `#1b1d24`, and `api`'s terminal background `#ffffff` with foreground `#1b1d24`; its process is still running and its scrollback is unchanged. Picking `Dark` restores AC1's colours.
- **AC4 – System theme:** Given theme `System`, when the OS appearance is light (in tests, Electron's `nativeTheme.themeSource`/emulated `prefers-color-scheme: light`), then the board and terminals use the light palette; when it switches to dark, they switch to the dark palette without a restart.
- **AC5 – Font size:** Given `api` open at full size at 13 px in the default window (about 100 columns), when the user sets Font size `18`, then the terminal's font size is 18 px, it shows fewer columns than before, and the shell in `api` sees the new size (`tput cols` prints the terminal's new column count). Typing `40`, `7`, `12.5` or `abc` shows `Font size must be a whole number from 8 to 32` and the font stays 18 px; closing the dialog then reopening it shows `18`.
- **AC6 – Font family:** When the user enters `  Courier New, monospace  ` in Font family and presses Enter, then every terminal's font family is `Courier New, monospace`; clearing the field restores `Menlo, Consolas, monospace` and the field shows its placeholder. Typing `Courier New` without Enter and pressing `Escape` (or clicking outside) applies it as well; the field accepts at most 200 characters.
- **AC7 – Kept across restarts:** Given theme `Light`, size 16 and family `Courier New, monospace`, when Drovr is quit and started again, then the board is light from the first paint (the window's background is light before the page loads), Settings shows those three values, terminals use them, and `drovr-settings.json` holds `{"version":1,"settings":{"theme":"light","fontSize":16,"fontFamily":"Courier New, monospace"}}`. `drovr-state.json` keeps version 1 and its contents.
- **AC8 – Invalid file:** Given `drovr-settings.json` holding `{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}`, when Drovr starts, then the theme is `System`, the size 13, the family `Courier New`, and the app works; after picking `Dark` the file holds `{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New"}}`. Given the file holds `not json`, Drovr starts with all defaults.
- **AC9 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Settings model, file and theme:** plain core module for D1 and D7 (defaults, per-field validation, parse/serialize the file, family trimming) and a settings file with injected fs (atomic write, 200 ms debounce, flush; the state file's pattern); main loads it before the window, sets `nativeTheme.themeSource` and the window background (D2), registers `settings:load`/`settings:save` (D6) and flushes on quit; `window.drovr.settings` in `src/shared/api.ts` and preload; the light palette in CSS under `prefers-color-scheme: light` (D2); the renderer loads settings at start. Vitest for every case in D1, D7, AC8; `CONTEXT.md` gains **Settings** (app-wide preferences in `drovr-settings.json`; not saved state, and not the unsaved UI preferences). Satisfies AC1 (board part), AC8.
2. **S2 – Settings dialog:** sidebar `Settings` button and `Cmd/Ctrl+,` (a core shortcut matcher next to `isBackShortcut`, reached also from the terminal's key handler) open the modal of D5; theme radios apply live and save; font fields validate and save (D5) even before S3 uses them. New `e2e/settings.spec.ts` covers AC2, AC3 (board colours), AC4, AC7 (theme part), AC8. Satisfies AC2, AC4, AC7, AC8.
3. **S3 – Terminals follow settings:** the core terminal palettes (D3); every terminal created with the current theme and font and updated live on theme, OS appearance or font change, refitting and resizing the PTY of the open one (D4). Vitest for the palettes and the font-family rule; e2e AC1 (terminal part), AC3 (terminal part), AC5, AC6, AC7. `AGENTS.md`'s smoke-test list names `e2e/settings.spec.ts`. Satisfies AC1, AC3, AC5, AC6, AC7, AC9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | Fresh data dir; read body background and xterm options; check no settings file |
| AC2 | e2e | Click sidebar Settings (expanded and collapsed); read the dialog; close each way; shortcut on board, in full-size view, with another dialog open |
| AC3 | e2e | Pick Light; read computed colours of body, sidebar and the terminal; check `api` still running and its output present |
| AC4 | e2e (emulated colour scheme) | With System, switch emulated appearance; read colours |
| AC5 | e2e | Set 18; read xterm font size and cols; run `tput cols`; type invalid sizes; reopen dialog |
| AC6 | unit + e2e | Enter the padded family; read xterm option; clear; read again |
| AC7 | unit + e2e | Set values; restart through `e2e/launch.ts` with the same data dir; read dialog, colours and both files |
| AC8 | unit + e2e | Write the bad file before launch; read dialog; pick Dark; read the file; repeat with `not json` |
| AC9 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS that `System` follows a change of System Settings › Appearance while Drovr runs, and that the title bar matches the theme.

## Stack changes

None: Electron's `nativeTheme` and xterm.js's `theme`/font options are already in the stack; no new dependency or service.

## Data and migrations

New file `drovr-settings.json` in `userData`, created on the first change. `drovr-state.json` is unchanged (still version 1); existing users start with all defaults, which look as Drovr does today under a dark OS appearance (under a light one, `System` makes it light).

## Out of scope

- Cursor style, cursor blink, scrollback length, line height, bell, and other terminal options.
- Custom or imported colour themes; per-workspace or per-card settings.
- Saving window size or the collapsed sidebar (still not saved, per **Saved state**).
- An app menu entry for Settings (the app has no custom menu yet).
- Checking that a font family is installed, or listing installed fonts.

## Open questions

None.
