---
item: 70
type: bug
title: Code not found
status: approved
branch: claude/70-code-not-found
---

# Code not found

## Problem

A user with VS Code installed gets `Couldn't open SKILL.md: code not found` in the Files tab ([image 1]) and `Couldn't open settings.json: code not found` from the Agent setup page's Open file button ([image 2], [image 3]). Settings > Editor (default VS Code) only runs the editor's CLI from the login shell's PATH (#55 D13, D15), and on macOS VS Code's `code` is on no PATH until the user runs *Shell Command: Install 'code' command in PATH*; the same goes for Cursor's `cursor` and Zed's `cli`, and for Linux installs from Flatpak or Snap. After this ships, a VS Code, Cursor or Zed that is installed opens the file even when its CLI isn't on the PATH, Settings > Editor marks the editors it can't find, and an editor that can't be found falls back to the system's default app instead of opening nothing.

## Domain decisions

- **D1 – Where an editor is looked for:** VS Code, Cursor and Zed are looked for in order: their command names on the login shell's PATH (`code`; `cursor`; `zed`, then `zeditor`, Arch's name for it), then the absolute paths their installers use, the first executable regular file winning:
  - macOS: `/Applications/<App>.app/…` and `~/Applications/<App>.app/…` with `Visual Studio Code.app/Contents/Resources/app/bin/code`, `Cursor.app/Contents/Resources/app/bin/cursor`, `Zed.app/Contents/MacOS/cli`; then `/opt/homebrew/bin/<cmd>` and `/usr/local/bin/<cmd>`.
  - Linux: `/usr/share/code/bin/code`, `/snap/bin/code`, `/var/lib/flatpak/exports/bin/com.visualstudio.code`, `~/.local/share/flatpak/exports/bin/com.visualstudio.code`; Cursor `~/.local/bin/cursor`, `/opt/cursor/cursor`, `/usr/bin/cursor`; Zed `~/.local/bin/zed`, `/var/lib/flatpak/exports/bin/dev.zed.Zed`, `~/.local/share/flatpak/exports/bin/dev.zed.Zed`.
  - `~` is `BIKUBE_HOME_DIR` when set (as #68's reader), else the OS home.
  The lookup and the start run in the same login shell script as today (`-l -c`, every name and path a positional argument, never in the parsed text; fish its own syntax, other shells `/bin/sh -l`), so the editor still gets the user's PATH and environment (#55 D15). It gets the folder and the file as before. *Why:* the bundle's own CLI script behaves exactly like the installed `code` command; macOS `open -b` was rejected as it can't pass `--`-style arguments the same way on Linux and its failure exits 1, not 127.
- **D2 – Settings > Editor shows what is installed:** main checks which of VS Code, Cursor and Zed D1 finds (`editors:installed`, main frame only, the same login shell check as `agents:installed`, one at a time) and the renderer asks at launch and on window focus at most every 30 s, as installed agents. The Open files with select labels an editor not found `<Name> (not installed)` and disables it, unless it is the saved choice (which stays selectable so the select shows it). System default and Custom command are always enabled. While unknown (not yet answered, or the check failed) nothing is marked. *Why:* the item asks for the list to show available editors; disabling rather than hiding keeps the choices discoverable, as the agent selects do.
- **D3 – Fallback to the default app:** when the chosen VS Code, Cursor or Zed isn't found (D1's script finds no candidate, says so with its own marker on stderr and exits 127; a found editor that itself exits 127 is an ordinary failure with its own reason), the file opens with the system's default app (`shell.openPath`, as System default opens it). The Files tab and the Agent setup page then show a note, not an error: `Opened <file name> with the default app: <cmd> not found` (the same banner, dismissable, styled as a note in muted text, `role="status"`). If the default app fails too, the error line is today's `Couldn't open <file name>: <cmd> not found`. A Custom command that isn't found doesn't fall back (the user asked for exactly that command). *Why:* the item asks for a fallback; opening the file is what the user wanted, and the note says why their editor didn't.

## Acceptance criteria

- **AC1 – Bundle CLI used:** Given Settings > Editor is VS Code, no `code` on the login PATH, and an executable `code` at `~/.local/share/flatpak/exports/bin/com.visualstudio.code` (Linux; on macOS `~/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`) under `BIKUBE_HOME_DIR`, when a file is opened from the Files tab, then that program runs with the shown folder and the file's absolute path as its arguments and no error or note shows. The same holds for the Agent setup page's Open file.
- **AC2 – PATH first:** Given both a `code` on the login PATH and one at a D1 path, when a file is opened, then the PATH's `code` runs.
- **AC3 – Settings marks missing editors:** Given only Zed is found, when Settings > Editor is opened with VS Code saved, then the select's options read `VS Code`, `Cursor (not installed)` (disabled), `Zed`, `System default`, `Custom command`; given the check failed, no option reads `(not installed)`.
- **AC4 – Fallback note:** Given Settings > Editor is VS Code and no `code` is found anywhere, when `a.ts` is opened from the Files tab, then `shell.openPath` gets the file's absolute path and the note `Opened a.ts with the default app: code not found` shows; given `shell.openPath` returns an error, the error line `Couldn't open a.ts: code not found` shows instead.
- **AC5 – Custom command unchanged:** Given a Custom command `fake-missing` that isn't found, when a file is opened, then nothing else runs, `shell.openPath` isn't called and `Couldn't open a.ts: fake-missing not found` shows.

## Slices

1. **S1 – Find, list and fall back:** D1's candidate list and login shell script in the editor core (with a Vitest on real shells and temp candidate paths), D3's fallback and its note (`OpenResult` gains the opened-with-default case, `openErrorLine`/`listedFileErrorLine` give the note's text, both banners show it as a note), D2's check in main, its preload API, the renderer's store and the Settings select; e2e in `e2e/side-panel.spec.ts` (update #55 AC14's missing-editor expectation to the fallback, `shell.openPath` stubbed) and the settings select. Satisfies AC1–AC5.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest `editor.test.ts` (a temp candidate path, no PATH entry); e2e side panel with a fake flatpak export under `BIKUBE_HOME_DIR` | Open a file from the Files tab; the fake logs its arguments |
| AC2 | Vitest `editor.test.ts` | — |
| AC3 | Vitest for the installed-editors parse; e2e Settings > Editor with a fake `zed` on the login PATH | Open Settings > Editor and read the options |
| AC4 | Vitest `open-result` lines and `openInFolder` with an injected `openPath`; e2e with `shell.openPath` stubbed through `app.evaluate` | Open a file with no editor installed; read the note |
| AC5 | Vitest `editor.test.ts` | — |

## Stack changes

None.

## Data and migrations

None. The `editor` setting's values are unchanged.

## Out of scope

- Detecting other editors (Sublime, JetBrains, VS Code Insiders) or adding them to the select.
- Changing the default editor when VS Code isn't installed.
- Windows install locations.

## Open questions
