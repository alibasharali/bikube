---
item: 45
type: feature
title: "Shell integration: prompt marks and command status"
status: draft
branch: claude/45-shell-integration-marks
---

# Shell integration: prompt marks and command status

## Problem

A workspace's shells and a card's extra panes run dev servers, test runs and builds, but Drovr knows nothing about what happens in them: there is no agent to set an activity. Other terminals (Ghostty, iTerm2, WezTerm, Kitty, VS Code, Warp) learn it from shell integration: the shell marks where each prompt, command and output starts and how each command ended (OSC 133, VS Code's OSC 633) and reports its directory (OSC 7). After this item, every local Drovr terminal running zsh, bash or fish sends those marks without any setup, and Drovr uses them (in any terminal that sends them) to jump between prompts, mark failed commands with their exit code, notify when a long command finishes out of sight, and start a new split in the directory the shell is in.

## Domain decisions

- **D1 – Marks understood:** every terminal (a card's main pane, an extra pane, a workspace's shell, local or SSH) watches its output for OSC 133 and OSC 633 marks: `A` prompt start, `B` prompt end (command line start), `C` command output start, `D[;<exit code>]` command finished; and for the directory: OSC 7 `file://<host><path>` (percent-decoded) and OSC 633 `P;Cwd=<path>`. Every other OSC 633 command (`E`, other `P` properties) is ignored. Marks are watched through xterm's parser and never swallowed (xterm's own handling is unchanged, nothing is replied), the same way as #58's probe. Marks are runtime only, kept with the screen and gone with it (a Stopped card, a closed pane), never saved or synced. *Why:* honouring both families covers our own scripts, VS Code's and the integrations users already have for Ghostty, iTerm2, WezTerm or Kitty.
- **D2 – A command:** a command starts at `C` and ends at the next `D`. Its line is the row of the latest `B` before that `C` (else of the latest `A`, else the row of `C` itself). A `D` with no `C` since the last `D` ends nothing (an empty Enter at the prompt in zsh and fish, a duplicate `D`). Its exit code is the `D`'s integer argument; a `D` without one, or with something not an integer, counts as exit code 0. The prompts the jumps use are the rows of `A` marks (of `B` marks in a terminal that never sent an `A`).
- **D3 – Injected for zsh, bash and fish, locally:** when Drovr starts a local shell (main pane, extra pane, workspace shell) whose program's file name is exactly `zsh`, `bash` or `fish` and the Shell integration setting is on, it starts it with Drovr's integration script for that shell, which sends `A`, `B`, `C`, `D;<exit code>` and an OSC 7 for each prompt, and changes nothing else the user sees (prompt, `$?` / `$status` seen by the user's own prompt and hooks, PROMPT_COMMAND, precmd/preexec hooks, history). Like VS Code and Ghostty:
  - **zsh:** `ZDOTDIR` is set to Drovr's zsh folder, with the user's own `ZDOTDIR` (when set) kept in another variable. Drovr's `.zshenv` restores `ZDOTDIR` at once (unset when it was unset), sources the user's own `.zshenv`, and in an interactive shell loads the integration; zsh then reads the user's `.zprofile`, `.zshrc` and `.zlogin` as usual. Still started with `-l`.
  - **bash:** started as `bash --init-file <Drovr's script>` (not `-l`, which would make bash ignore it). The script does what a login shell does first (`/etc/profile`, then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists), then installs the integration. It works on bash 3.2 (macOS's `/bin/bash`), which has no `PS0`.
  - **fish:** `XDG_DATA_DIRS` gets Drovr's folder first (and `/usr/local/share:/usr/share` after it when it was unset), whose `fish/vendor_conf.d` script removes that entry again and installs the integration on fish's events. Still started with `-l`.
  - Any other shell (`sh`, `dash`, `nu`, `tcsh`…) starts exactly as today. The scripts live in `resources/shell-integration/`, packaged as `extraResources` like `resources/bin/`. The variables Drovr adds for the injection are removed by the scripts, so a shell started inside it (a nested `zsh`) is the user's plain one.
  *Why:* no setup and no change to the user's dotfiles; proven by VS Code and Ghostty.
- **D4 – Never over SSH, switchable:** SSH terminals (main and extra panes of an SSH card or shell) get no injection (the local shell only runs `ssh`); marks the remote shell sends anyway are honoured (D1). A **Shell integration** switch in Settings' terminal preferences, on by default and saved in `drovr-settings.json` only when off (`shellIntegration: false`), turns the injection off for terminals started after the change; terminals already running keep what they started with. Marks from a shell the user integrated themselves are honoured either way. *Why:* a card's main pane is a shell too; the switch is the escape hatch if injection breaks someone's setup.
- **D5 – Previous prompt, Next prompt:** two new shortcuts, `Previous prompt` (Cmd+Up on macOS, Ctrl+Shift+Up elsewhere) and `Next prompt` (Cmd+Down, Ctrl+Shift+Down), recordable, refused and reset in Settings' Shortcuts section like the others, act on the focused pane of the open card or shell. Previous scrolls the pane so that the last prompt above the top of its viewport is the top row; Next scrolls so that the first prompt below the top of the viewport is the top row, or to the bottom when there is none. With no such prompt Previous does nothing. The pane's shell never receives the keys (like every shortcut, #31 D7), also when nothing happens. They are not added to the command palette. *Why:* iTerm2 and Ghostty use Cmd+Up/Down; off macOS Ctrl+Shift keeps Ctrl+Up for the shell, like the other shortcuts there.
- **D6 – A failed command:** a command (D2) that ended with an exit code other than 0 gets, on its line: a red bar along the left edge of the terminal, a red mark in the terminal's overview ruler, and a small red badge `✗ <code>` at the right edge of the terminal; the bar and the badge have the tooltip `Exit code <code>`. A command that ended with 0, or isn't ended yet, gets nothing. The marks scroll with the line and go when it leaves the scrollback (or is cleared); they never cover the terminal's text beyond the first and the badge's last cells, and never take clicks from the text. *Why:* shows exactly what failed without noise on every prompt.
- **D7 – Long command finished:** when a command (D2) that ran 10 seconds or more (from its `C` to its `D`, as the renderer parsed them) ends in a terminal the user isn't looking at, Drovr sends a notification like an agent's (#31): title the card's or shell's title, body `Command finished · <workspace>` for exit code 0, `Command failed (exit <code>) · <workspace>` otherwise; the tone when Notification sound is on, the window's attention request; nothing when Notifications are off. Not looking at it: the window isn't focused, or the card or shell isn't open at full size, or the pane isn't its focused pane. Clicking the notification focuses the window and opens the card or shell (switching workspace and starting it as a click would) and focuses that pane if it is still there. It changes no activity, the waiting queue or the Dock badge. *Why:* reuses the notifications users know; a fixed threshold avoids another setting.
- **D8 – New splits in the shell's directory:** in a local card or shell, a new split starts in the directory the focused pane's shell last reported (D1), when that is a local path (OSC 7's host empty, `localhost` or this machine's host name; any 633 `Cwd`) that is still an existing directory; otherwise in the card's or shell's own directory, as today. An SSH card's or shell's splits always start in its own directory. The board, the title bar, the side panel and the card's saved directory never change. *Why:* what the idea asks for; the title bar keeps showing the card's folder.

## Acceptance criteria

- **AC1 – Marks parsed:** Given the mark state of a terminal, when it is fed `A`, `B`, `C`, `D;2` (OSC 133, or the same through OSC 633), then it has one command whose line is the `B` row, exit code 2, with its start and end times; `D` alone after it ends nothing; `D` with no code or `D;x` reads 0; OSC 7 `file://host/tmp/a%20b` reads host `host`, path `/tmp/a b`; 633 `P;Cwd=/srv` reads `/srv`; 633 `E;ls` changes nothing. (Vitest)
- **AC2 – Failed command marked:** Given a workspace's Default shell (Shell `/bin/sh`, no injection) where the user runs `printf '\033]133;A\007$ \033]133;B\007'; printf '\033]133;C\007'; printf '\033]133;D;3\007'`, then the terminal shows a failed-command mark on that command's line with the badge `✗ 3` and tooltip `Exit code 3`; with `D;0` no mark appears. (e2e)
- **AC3 – Injection, per shell:** Given the Shell integration setting on, then the spawn for a local `/bin/zsh` sets `ZDOTDIR` to Drovr's zsh folder and keeps the user's in another variable, for `/usr/bin/bash` uses `--init-file <script>` instead of `-l`, for `/usr/bin/fish` puts Drovr's folder first in `XDG_DATA_DIRS`, and for `/bin/sh`, an SSH card's local shell, or the setting off, it is unchanged (`-l`, no added variables). (Vitest)
- **AC4 – The scripts work:** Given a real bash (and zsh and fish where installed; CI installs them) started as Drovr starts it, with a home folder whose login files set a variable and a prompt, when `true`, `false` and `cd /tmp` are run, then the output holds `A`, `B`, `C`, `D;0`, then `D;1`, and an OSC 7 for `/tmp`; the login files' variable is set, the user's prompt is unchanged, `$?` seen by a user `PROMPT_COMMAND`/`precmd` is the command's, and a nested shell started from it has none of Drovr's injection variables. (Vitest, through node-pty)
- **AC5 – End to end in bash:** Given the Shell setting `/bin/bash` and Shell integration on, when the user runs `false` in the Default shell, then the failed-command mark with `✗ 1` appears on its line; with Shell integration off and a new shell, it doesn't. (e2e)
- **AC6 – Prompt jumps:** Given a shell where 3 commands each printed 100 lines after their prompts (marks sent), when the user presses Previous prompt (Ctrl+Shift+Up on Linux) once, then the viewport's top row is the third prompt; again, the second; Next prompt then shows the third at the top, and Next again scrolls to the bottom. The shell received none of the keys. The shortcuts are recordable and Reset in Settings. (Vitest for the row picking, e2e for the keys)
- **AC7 – Long command notification:** Given a shell's extra pane that is not focused, when a command marked as running 10 s or more ends with exit 4 (the threshold shortened for the test, development build only), then a notification `Command failed (exit 4) · <workspace>` is sent with the shell's title; when the same ends in the focused pane of the open shell in the focused window, none is sent; with Notifications off, none. (Vitest for the rule, e2e with a stubbed `Notification`)
- **AC8 – Split in the shell's directory:** Given a local card whose main pane reported OSC 7 for `/tmp` (after `cd /tmp` with injection, or the sequence printed), when the user splits right, then the new pane's `pwd` is `/tmp`; when the reported directory no longer exists, or its host is another machine, or the card is an SSH card, the new pane starts in the card's directory. (e2e)
- **AC9 – Packaged:** Given the packed Linux app, then `resources/shell-integration/` holds the zsh, bash and fish scripts. (`e2e/packaged.spec.ts`)
- **AC10 – No regressions:** every existing Vitest and e2e test stays green, including with bash as the login shell (CI's runner).

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Marks and failed commands:** the mark state (D1, D2) in core, watched by every terminal screen, and the failed-command marks (D6). Satisfies AC1, AC2.
2. **S2 – Injection and the setting:** the scripts for zsh, bash and fish, the spawn choosing them (D3, D4), the Settings switch, packaging, CI installing zsh and fish. Satisfies AC3, AC4, AC5, AC9.
3. **S3 – Prompt jumps:** the two shortcuts and the row picking (D5). Satisfies AC6.
4. **S4 – Long command notifications** (D7). Satisfies AC7.
5. **S5 – Splits in the shell's directory** (D8). Satisfies AC8, AC10.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest, core mark state | `npm test` |
| AC2 | e2e `e2e/shell-integration.spec.ts` | Default shell, print the marks, read the decoration |
| AC3 | Vitest, core injection choice | `npm test` |
| AC4 | Vitest with node-pty and real shells (skipped where a shell is missing, never in CI) | `npm test` |
| AC5 | e2e `e2e/shell-integration.spec.ts` | Shell `/bin/bash`, run `false` |
| AC6 | Vitest + e2e `e2e/shell-integration.spec.ts` | print 3 marked commands, press the shortcuts, read `buffer.active.viewportY` |
| AC7 | Vitest + e2e `e2e/shell-integration.spec.ts` | stubbed `Notification`, shortened threshold |
| AC8 | e2e `e2e/shell-integration.spec.ts` | `cd /tmp`, split, `pwd` in the new pane |
| AC9 | `e2e/packaged.spec.ts` | `xvfb-run -a npm run test:packaged` |
| AC10 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` |

## Stack changes

None. (CI installs `zsh` and `fish` from Ubuntu's packages for the tests; nothing ships with the app.)

## Data and migrations

`drovr-settings.json` gains `shellIntegration` (only written as `false`) and two shortcut actions, `previousPrompt` and `nextPrompt`, in `shortcuts`; files without them read the defaults. Nothing in the saved state or the sync file.

## Out of scope

- Selecting a command's output (follow-up item), and copying a command or its output.
- Injection over SSH.
- Marks for successful commands, command durations shown in the terminal, and a command palette row for the jumps.
- Changing a card's or shell's activity, status line or the waiting queue from commands.
- Shells other than zsh, bash and fish.

## Open questions

None.
