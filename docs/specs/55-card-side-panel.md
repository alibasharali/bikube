---
item: 55
type: feature
title: 'Right side panel for open card'
status: approved
branch: claude/55-card-side-panel
---

# Right side panel for open card

## Problem

With a card open at full size, the only way to see which files its agent is working on, or what it has changed, is to type `ls` and `git status` in a pane, and opening a file in an editor means switching apps and finding the folder. After this ships, an open card (or workspace shell) has a side panel on its right with tabs; its first tab, **Files**, is a file explorer of the card's folder that marks what git sees as changed, can list only the changed files, and opens a file in the user's editor (VS Code by default) on double-click.

Builds on the full-size card view (`CardView`, no bar since #31), the configurable shortcuts (#31, `src/core/keymap.ts`), the settings file (#10, `src/core/settings.ts`) and the branch menu's git plumbing (#33: `src/core/git.ts`'s injected `GitRunner`, no-prompt `gitEnv`, `spawnRunner`, and `src/main/git.ts`'s main-frame guard and folder checks).

## Domain decisions

- **D1 – Where the panel is:** while a card or a workspace shell is open at full size, the panel sits at the right of the view, full height of the content area, beside the panes (which shrink to fit and re-fit their terminals). Its header is a tab strip with one tab, **Files** (built so later tabs are added to the strip), and a hide button at its right end. Not on the board, not in Settings. *Why:* item; developer's answer (Q1).
- **D2 – Toggling:** a panel button at the right end of the title bar (shown only while a card or shell is open; pressed state = panel shown, `aria-pressed`) and a new configurable shortcut **Toggle panel** (Settings > Shortcuts; default `Alt+Cmd+B` on macOS, `Ctrl+Alt+B` elsewhere) show or hide it; the panel's hide button hides it. The shortcut works with focus in a terminal, is swallowed on auto-repeat and does nothing behind a dialog, like the card's other shortcuts. Shown by default on first use. *Why:* developer's answer (Q1); a VS Code-like key for the secondary side bar that collides with no existing default.
- **D3 – Open state and width are saved:** whether the panel shows and its width are app-wide preferences kept in `drovr-settings.json` (`sidePanelOpen`, default `true`; `sidePanelWidth`, default `280`), written only when they differ from their defaults (as `Preferences`), never synced, one value for every card and shell. Hiding the panel in one card hides it in every card, now and after a restart. *Why:* developer's answers (Q1, Q10). This is the first UI preference that is saved: `CONTEXT.md`'s Settings entry says so.
- **D4 – Width:** the panel's left edge is a drag handle (`col-resize` cursor; also a `separator` with Left/Right arrow keys moving 16 px). Width is kept between 200 px and half the window's width; a saved width larger than half the current window shows at half and is kept as saved until the user drags. The width is saved when a drag ends, not on every move. *Why:* developer's answer (Q10).
- **D5 – Which folder:** the Files tab shows the card's own directory (a worktree card's worktree, else the folder the card was created in); for an open workspace shell, the workspace's folder. Its root row reads the folder's name, with the full path as tooltip. *Why:* developer's answers (Q2, Q4).
- **D6 – SSH:** for an SSH card or a shell of an SSH workspace the panel shows as usual and the Files tab reads `Files aren't available over SSH yet`; nothing is listed, no git runs. *Why:* developer's answer (Q3).
- **D7 – The tree:** folders first, then files, each group sorted by name (case-insensitive, natural order: `file2` before `file10`); every entry is listed, hidden (dot) files included, except `.git`. A folder's contents are read only when it is expanded (one level at a time); the root is expanded when the tab first shows. Expanded folders are remembered per folder shown for the run of the app (not saved), so leaving and reopening a card keeps them. A folder with more than 2,000 entries shows the first 2,000 and a last row `… <n> more`. A folder that can't be read shows `Can't read this folder` under it. Rows are keyboard-navigable as a `tree` (Up/Down move, Right/Left expand/collapse, Enter opens a file as double-click does). *Why:* developer's answer (Q5); reading lazily keeps `node_modules` cheap.
- **D8 – Ignored entries:** in a git repository, entries git ignores (as `git check-ignore` says, so `.gitignore`, `.git/info/exclude` and the global excludes count) are shown dimmed; an ignored folder's contents load only when expanded, like any folder, and show dimmed too. Outside a repository nothing is dimmed. *Why:* developer's answer (Q5).
- **D9 – Symlinks:** a symlink is listed with its own name and an arrow; one pointing to a folder inside the shown folder expands like a folder; one pointing outside it, or broken, is a leaf that doesn't expand. *Why:* main only reads inside the folder it was given (D16).
- **D10 – Changes:** in a git repository, every path `git status` reports (staged, unstaged and untracked, against HEAD, ignored files excluded) inside the shown folder gets a coloured letter at its row's right: `M` modified, `A` added (staged new file), `D` deleted, `U` untracked, `R` renamed (at its new path; tooltip `Renamed from <old path>`), `C` conflicted (unmerged). Staged and unstaged combine into one letter (a file both staged and modified reads `M`). A folder containing any changed path shows a dot. A deleted file, gone from disk, still shows as a row (struck through, letter `D`) in its folder. *Why:* developer's answer (Q6).
- **D11 – Changed only:** a **Changed only** toggle button in the Files tab's header switches the tree to just the changed paths (D10) and the folders leading to them, all expanded; the toggle is remembered per folder shown for the run (not saved). With nothing changed it reads `No changes`. Outside a repository the toggle is disabled with tooltip `Not a git repository`. *Why:* developer's answer (Q6).
- **D12 – Refresh:** while the Files tab shows and the window is focused, the shown folder's expanded folders and its git status are read again every 3 seconds, and at once when the panel opens, when the window gains focus, and with a **Refresh** button in the tab's header. A read never starts while the previous one for that folder is running. Nothing is read while the panel is hidden, the window is unfocused or no card or shell is open. A refresh keeps expansion, selection and scroll position. *Why:* developer's answer (Q7), paused when unfocused so many open windows of work cost nothing (a focus triggers a read at once).
- **D13 – Opening a file:** double-click (or Enter) on a file opens it with the editor setting (D14); on a folder it expands or collapses. A deleted file does nothing. VS Code, Cursor and Zed are given the shown folder and the file (`code <folder> <file>`, `cursor <folder> <file>`, `zed <folder> <file>`), which opens the folder as the project with the file in it, reusing that folder's window when it is already open. When the editor can't be started (command not found, non-zero exit), the Files tab shows an error line `Couldn't open <file name>: <reason>` (e.g. `code not found`) until the next open or a click on its dismiss button. *Why:* developer's answer (Q9).
- **D14 – The editor setting:** a new Settings section **Editor** with *Open files with*: `VS Code` (default), `Cursor`, `Zed`, `System default` (the OS's default app for the file, through Electron's `shell.openPath`) or `Custom command` with a one-line text field. A custom command is run by the user's shell with the file's absolute path appended as one shell-quoted argument (e.g. `subl -n` runs `subl -n '/path/to/file'`); an empty custom command opens nothing and shows `Set a command in Settings > Editor`. Kept in `drovr-settings.json` as `editor` (`vscode`, `cursor`, `zed`, `system`, `custom`; default `vscode`) and `editorCommand` (default `''`), written only when not default, invalid values read as default. *Why:* developer's answer (Q8).
- **D15 – Editors run with the user's PATH:** VS Code, Cursor, Zed and custom commands run through the user's login shell (the Shell setting, else `$SHELL`, else `/bin/sh`) as a login shell (`-l -c`), with the editor's command and the paths passed as positional arguments (never pasted into the command text) and the custom command text being the only text the shell parses, detached, stdin closed, output kept only for the error line. *Why:* an app started from Finder or a desktop launcher doesn't have `/usr/local/bin` or `~/.local/bin` on PATH; the user's shell does, as in their cards.
- **D16 – Main checks its input:** listing, ignore checks, git status and opening run in main. Every request names the shown folder (an absolute, existing directory) and, for a listing or an open, a path inside it; main resolves the real path and refuses (`ok: false`, nothing read or run) anything that resolves outside the folder (`..`, a symlink escaping it). Requests come from the main frame only. Git uses `src/core/git.ts`'s runner with the no-prompt environment, read-only commands only (`status`, `check-ignore`, `rev-parse`), with `--no-optional-locks` so a refresh never takes the index lock a running agent's git might need. contextIsolation, nodeIntegration and sandbox unchanged. *Why:* AGENTS.md; a polling read must never block the agent's own git.
- **D17 – No change to cards:** the panel never changes a card, its process, its panes, the board or saved state; it reads files and runs read-only git. *Why:* scope.

## Acceptance criteria

Unless stated otherwise: a local workspace `repo` on a git repository with committed files `README.md`, `src/a.ts`, `src/b.ts`, a `.gitignore` containing `dist/`, an ignored `dist/out.js`, and a fresh data directory (so the panel shows by default); a card `c1` in `repo` is open at full size.

- **AC1 – Shown by default:** when `c1` opens, then a panel shows at the right of the panes, 280 px wide, with one tab `Files` selected, and the title bar's panel button is pressed.
- **AC2 – Toggle and saved:** when the user presses the Toggle panel shortcut (`Ctrl+Alt+B` on Linux) with focus in the terminal, then the panel hides, the panes widen and the panel button is unpressed; `drovr-settings.json` holds `"sidePanelOpen": false`; after a restart and opening `c1`, the panel is still hidden; clicking the panel button shows it again and the file no longer holds `sidePanelOpen`. The panel's hide button hides it too. Held down, the shortcut toggles once; behind an open dialog it does nothing.
- **AC3 – Shortcut configurable:** Settings > Shortcuts lists `Toggle panel` with the default above; recording `Ctrl+Alt+P` makes that key toggle the panel and `Ctrl+Alt+B` no longer does.
- **AC4 – Resize:** when the user drags the panel's left edge 120 px to the left, then the panel is 400 px wide and after a restart it is still 400 px; dragging far right stops at 200 px, far left at half the window's width.
- **AC5 – Tree:** when the Files tab shows, then the root row reads `repo` and lists `dist`, `src` (folders, in that order) then `.gitignore`, `README.md`; `.git` is not listed; `dist` is dimmed; expanding `src` lists `a.ts`, `b.ts`; expanding `dist` lists `out.js`, dimmed.
- **AC6 – Remembered expansion:** given `src` is expanded, when the user goes Back and opens `c1` again, then `src` is still expanded.
- **AC7 – Changes marked:** given `src/a.ts` is modified, `src/new.ts` is untracked, `README.md` is deleted and `src/b.ts` is staged as renamed to `src/c.ts`, when the panel shows, then within 4 s `src` shows a dot, `a.ts` reads `M`, `new.ts` `U`, `c.ts` `R` with tooltip `Renamed from src/b.ts`, and `README.md` is struck through with `D`.
- **AC8 – Changed only:** with the changes of AC7, when the user presses Changed only, then the tree lists only `README.md`, `src`, and in it `a.ts`, `c.ts`, `new.ts`, and no `dist` or `.gitignore`; with no changes it reads `No changes`.
- **AC9 – Refresh:** given the panel shows, when a pane runs `touch src/z.ts`, then within 4 s `z.ts` appears under the expanded `src` with `U`, without collapsing anything; the Refresh button shows it at once.
- **AC10 – Worktree and shell:** given a worktree card is open, then the root row reads the worktree's folder name and lists its files; given the workspace's Default shell is open, the root row reads `repo`.
- **AC11 – Not a repository:** given a local workspace on a folder that isn't a git repository, the tree lists its files, nothing is dimmed or marked, and Changed only is disabled with tooltip `Not a git repository`.
- **AC12 – SSH:** given an SSH workspace's card is open (fake `ssh`), the panel shows and the Files tab reads `Files aren't available over SSH yet`.
- **AC13 – Open in VS Code:** given a fake `code` on the login shell's PATH that logs its arguments, when the user double-clicks `a.ts`, then `code` is run once with `<repo>` and `<repo>/src/a.ts`; Enter on a selected file does the same; double-clicking `src` toggles it and runs nothing.
- **AC14 – Editor setting:** when the user picks Custom command `fake-editor --wait` in Settings > Editor and double-clicks `README.md` (not deleted), then `fake-editor` runs with `--wait` and `<repo>/README.md`; `drovr-settings.json` holds `"editor": "custom"` and `"editorCommand": "fake-editor --wait"`. With `code` not installed and VS Code chosen, the tab shows `Couldn't open a.ts: code not found`.
- **AC15 – Main refuses escapes:** a listing or open request for `<repo>/../outside` or through a symlink pointing outside `repo` returns `ok: false` and reads or runs nothing (unit).
- **AC16 – Core:** the listing (sorting, cap, symlinks, ignored marks), git status parsing (letters, renames, conflicts, folder dots, only paths inside the shown folder) and the editor command building (each editor, custom command quoting, positional arguments) pass Vitest, the git parts on real throwaway repositories.
- **AC17 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – The panel:** the `sidePanelOpen` and `sidePanelWidth` preferences, the Toggle panel shortcut, the panel beside the panes for cards and shells with its tab strip, Files tab placeholder, hide button, title-bar button, resize handle, the SSH message. Satisfies AC1, AC2, AC3, AC4, AC12.
2. **S2 – File tree:** main's guarded folder listing (real-path checks, cap, symlinks) and ignore checks, the typed preload API, the lazy tree with dimmed ignored entries, keyboard navigation, remembered expansion, the 3 s/focus/Refresh reads. Satisfies AC5, AC6, AC10, AC11, AC15, part of AC9 and AC16.
3. **S3 – Changes:** git status in main (read-only, no optional locks), the letters, folder dots, deleted rows, the Changed only filter. Satisfies AC7, AC8, AC9, part of AC16.
4. **S4 – Opening files:** the `editor` and `editorCommand` settings, the Editor section in Settings, opening through the login shell or `shell.openPath`, the error line. Satisfies AC13, AC14, part of AC16, AC17.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2, AC3, AC4 | settings unit (preference defaults and checks), keymap unit; e2e `e2e/side-panel.spec.ts` | open a card: panel shows; press `Ctrl+Alt+B`; restart; drag the edge |
| AC5, AC6, AC10, AC11 | listing unit on temp folders; e2e | open a card in a repo, expand `src` and `dist`, Back and reopen |
| AC7, AC8, AC9 | git status unit on real throwaway repositories; e2e | change files in a pane, watch letters appear, press Changed only |
| AC12 | e2e with fake `ssh` (`e2e/fake-ssh.ts`) | open an SSH card |
| AC13, AC14 | editor command unit; e2e with a fake `code` and `fake-editor` on a fake login shell PATH | double-click a file; switch the editor in Settings |
| AC15 | main handler unit / core path-check unit | n/a (unit only) |
| AC16, AC17 | Vitest; `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | n/a |

## Stack changes

None.

## Data and migrations

`drovr-settings.json` gains four optional fields, each written only when it differs from its default: `sidePanelOpen` (boolean, default `true`), `sidePanelWidth` (integer 200–4000, default `280`), `editor` (`vscode` | `cursor` | `zed` | `system` | `custom`, default `vscode`), `editorCommand` (string, default `''`), and the shortcuts may hold `togglePanel`. Existing files load unchanged (missing fields read as defaults; invalid ones take the default and are reported like other invalid settings). The board's state and sync files are unchanged.

## Out of scope

- Files over SSH (D6), and any tab beyond Files.
- Showing a diff, staging, discarding or any git write from the panel.
- Creating, renaming, moving, deleting or dragging files; a file preview inside Drovr.
- A recursive file watcher (polling instead, D12) and search/filter by name.
- The panel on the board or for cards not open at full size.
- Per-card panel state; saving expansion or the Changed only toggle across restarts.

## Open questions

None.
