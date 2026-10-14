---
item: 12
type: feature
title: SSH and remote workspaces
status: approved
branch: claude/12-ssh-remote-workspaces
---

# SSH and remote workspaces

## Problem

Every card's terminal is a login shell on the Mac running Drovr. A developer whose repos, or whose agents, live on another machine (a dev box, a beefy build server, a VM) has to open a card and type `ssh …` by hand every time, and a restarted card's startup command (#5) then runs on the wrong machine. The product lists SSH and remote workspaces after v1, which is merged (#2–#11). After this ships, a workspace can be an **SSH workspace**: its cards' terminals open on a remote machine over the user's own `ssh`, in the workspace's remote directory, and their startup commands (Claude Code resume included) run there.

## Domain decisions

- **D1 – Location of a workspace:** a workspace is either local (as today) or an **SSH workspace**, which has an SSH **host**: a destination exactly as `ssh` takes it (`host`, `user@host`, an alias from `~/.ssh/config`, or `ssh://[user@]host[:port]`). Its working directory is a path on that host. Each card copies the host at creation together with the directory and keeps both for life (#4 D2): editing a workspace's location, host or directory changes new cards only, never existing ones. *Why:* round 1 Q1; matches #4 D2, so an edit never moves a card to another machine.
- **D2 – Host rule:** a host is trimmed, required for an SSH workspace, at most 255 characters, made only of ASCII letters, digits and `. _ @ : / % [ ] -`, and never starts with `-`. Error under the Host field: `Host is required` or `Enter a host as ssh takes it, e.g. me@devbox`. The same check runs in core for the dialog, for the saved-state file and in main for every spawn request. *Why:* round 1 Q2; the character set and no leading `-` keep the host from being read as an `ssh` option (e.g. `-oProxyCommand=…`); ports, keys and jump hosts belong in `~/.ssh/config`.
- **D3 – Remote directory rule:** for an SSH workspace the working directory is required and is an absolute path (`/…`) or `~` or `~/…`, at most 4096 characters, with no control characters; it is **not** checked on the remote machine when the dialog is saved (a missing one shows when a card starts, D7). Errors: `Working directory is required`, `Enter an absolute path or one starting with ~`. The folder picker (`workspace-browse`) is hidden for SSH. Local workspaces keep today's rules and local existence check. *Why:* round 1 Q3; a check over SSH outside a terminal can't answer password or host-key prompts.
- **D4 – Workspace dialog:** above the directory, a `Location` choice: `This computer` (default, `data-testid="workspace-location-local"`) or `SSH` (`workspace-location-ssh`). Choosing SSH shows a `Host` field (`workspace-host`, error `workspace-error-host`) and hides the folder picker. The name defaults as today to the directory's last path segment, and to the host when the directory is `~`. Editing a workspace shows and can change its location and host. *Why:* round 1 Q10.
- **D5 – How an SSH card runs:** the card's PTY runs the user's local login shell (as today, so the profile's PATH, `ssh-agent` and keychain apply) in the user's local home directory, with `-c` and the line `exec ssh -t -- <host> <remote command>`, where `<remote command>` is, for a POSIX remote login shell, `cd <dir> || exit 255; printf '\033]6973;drovr-ready\007'; exec "${SHELL:-/bin/sh}" -l`. `<dir>` is single-quoted, with a leading `~` or `~/` left unquoted so the remote shell expands it. Main builds this line in a core function from the card's host and directory, both re-checked by D2 and D3; the renderer never sends a command. Password, passphrase and host-key prompts appear in the card's terminal like any output; Drovr never sees or stores credentials. The local side gets none of the `board` variables (#9 D3). *Why:* round 1 Q4; the user's own `ssh` and config, no new dependency, nothing secret in Drovr.
- **D6 – Startup command over SSH:** for an SSH card the start line (#5 D3) is typed, once per start, when the ready marker (`ESC ] 6973 ; drovr-ready BEL`) first appears in the PTY's output, which can arrive split across chunks; if the session ends before it appears nothing is typed, and a Claude Code card's first start is then not recorded (#5 D5). The marker is never shown (xterm.js ignores the unknown OSC) and never becomes the card's last output line. Local cards still type it right after the spawn. *Why:* round 1 Q5; typed at once it would be eaten by a password or host-key prompt.
- **D7 – SSH failed:** when an SSH card's main shell exits by itself with exit code 255 (`ssh`'s own error: can't resolve or reach the host, authentication failed, connection dropped, or the remote directory is missing per D5), the card's status is `SSH failed: <its last output line at exit>` (`SSH failed: exit code 255` when there is none) instead of `Stopped`. Otherwise it behaves exactly like `Stopped` (#5 D6): the view returns to the board, the screen is gone, opening the card starts it again, Close and delete confirmations treat it as not running. Any other exit, and every stop caused by Close, delete or a page reload, is `Stopped`. It is runtime state: after a restart the card is `Stopped`. *Why:* round 1 Q6; without it the reason is lost with the discarded screen.
- **D8 – Panes in an SSH card:** every extra pane (#11 D1) of an SSH card runs its own `ssh` session as in D5, to the card's host and directory, with no startup command. An extra pane whose `ssh` exits with 255 keeps its screen and shows `SSH failed` read-only below it (like #11 D5's `Couldn't start`) until closed; any other exit removes it as today. *Why:* round 1 Q8.
- **D9 – No `board` in SSH cards:** remote shells don't get the `board` command; running it there is up to the remote machine (normally `command not found`). A follow-up idea on the board covers forwarding the socket. *Why:* round 1 Q7; the CLI runs on Drovr's own executable, which the remote machine doesn't have.
- **D10 – Saved state:** workspaces and cards gain an optional `host` (string), written only for SSH ones; a missing or `null` host means local, so existing `drovr-state.json` files load unchanged and the file stays version 1. A file with a `host` that fails D2, or an SSH workspace or card whose directory fails D3, is rejected as a whole like any broken invariant (#8 D3, D4). *Why:* round 1 Q9.
- **D11 – Showing the location:** for an SSH workspace, the sidebar entry's tooltip is `<host>:<directory>` (local ones keep the directory). The full-size view's header shows, for an SSH card, a line `<host>:<directory>` (`data-testid="card-view-location"`); local cards show nothing new. Board tiles are unchanged. *Why:* round 1 Q10; the user must tell a remote card apart where they type into it.
- **D12 – Security:** `terminal:spawn` gains one argument, the card's host (a string, or `null` for local); main refuses a host failing D2 or an SSH directory failing D3 with `invalid host` / `invalid working directory` (`Couldn't start: …`), and for a local spawn keeps every check it has. No other new IPC. contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md; the renderer is untrusted.

## Acceptance criteria

The smoke tests use a fake `ssh` (shared helper next to `e2e/fake-claude.ts`, on the login shell's PATH through the test HOME's `.bash_profile`). It logs its arguments to `$DROVR_SSH_LOG`; for host `unreachable` it prints `ssh: Could not resolve hostname unreachable: Name or service not known` and exits 255; otherwise it runs the remote command with `sh -c` under a cleared environment (`env -i` with only `HOME`, `PATH=/usr/bin:/bin`, `SHELL=/bin/bash`, `TERM`), so it behaves like a fresh remote login. `/tmp/drovr-remote` is an existing directory.

- **AC1 – Create an SSH workspace:** Given no workspaces, when the user creates a workspace with Location `SSH`, Host `me@devbox` and directory `/tmp/drovr-remote`, then the sidebar shows `drovr-remote`, its tooltip reads `me@devbox:/tmp/drovr-remote`, and the folder picker was not shown while SSH was chosen. With Host `-oProxyCommand=x` the dialog shows `Enter a host as ssh takes it, e.g. me@devbox`; with an empty host `Host is required`; with directory `relative/dir` it shows `Enter an absolute path or one starting with ~`; nothing is created in each case. A directory that doesn't exist locally (`/nope/remote`) is accepted for SSH.
- **AC2 – Editing changes new cards only:** Given SSH workspace `remote` (`me@devbox`, `/tmp/drovr-remote`) with card `a`, when the user edits the workspace to Host `other`, then a new card `b` connects to `other` (fake ssh log) and reopening Stopped card `a` connects to `me@devbox` again. Switching the workspace to `This computer` with directory `/tmp` makes new cards local shells in `/tmp`.
- **AC3 – Saved across restarts:** Given AC2's workspace, when Drovr restarts, then the workspace is still SSH with Host `other` (edit dialog), card `a` still connects to `me@devbox`, and `drovr-state.json` is version 1 with `host` on the SSH workspace and cards and none on local ones. A version-1 file without any `host` field (from before this item) loads with every workspace local. A file whose card has host `-x` is renamed to `drovr-state.corrupt-<timestamp>.json` and Drovr starts empty (#8 D4).
- **AC4 – A card runs on the host:** Given SSH workspace `remote` (`me@devbox`, `/tmp/drovr-remote`), when the user creates and opens card `api`, then the fake ssh log shows `-t -- me@devbox` and a remote command, `pwd` in the terminal prints `/tmp/drovr-remote`, `echo $DROVR_CARD_ID` prints an empty line, the header shows `me@devbox:/tmp/drovr-remote`, and the board tile reads `Running`. With directory `~` instead, `pwd` prints the fake remote's `$HOME`.
- **AC5 – Startup command after the marker:** Given SSH workspace `remote` whose fake ssh first prints `Password:` and waits 1 s before running the remote command (`FAKE_SSH_DELAY=1`), when the user creates Claude Code card `agent`, then the fake `claude` log (from the fake remote's PATH) gains exactly one line `--session-id <uuid>`, typed after the delay, and no part of the start line appears before `Password:` on the screen. The card's last output line on the board never shows `drovr-ready`.
- **AC6 – SSH failed:** Given SSH workspace with Host `unreachable`, when the user opens a new card, then the board is shown and the card reads `SSH failed: ssh: Could not resolve hostname unreachable: Name or service not known`; opening it again runs the fake ssh again (log gains a line). Given an SSH workspace with directory `/nope/remote`, a new card reads `SSH failed: ` followed by the remote shell's `cd` error (containing `/nope/remote`). Given a running SSH card, typing `exit` makes it `Stopped`; Closing it from its menu (#7) makes it `Stopped`.
- **AC7 – Refused spawn requests:** Calling `window.drovr.terminal.spawn(80, 24, '/tmp', '<cardId>', '-oProxyCommand=touch /tmp/pwned')` from the page resolves `{ ok: false, reason: 'invalid host' }` and `/tmp/pwned` is not created; with host `devbox` and directory `relative` it resolves `{ ok: false, reason: 'invalid working directory' }`. A local spawn (`null` host) still refuses a missing directory with `working directory not found`.
- **AC8 – Panes over SSH:** Given running SSH card `api`, when the user splits it right, then the fake ssh log gains a line for the same host, `pwd` in the new pane prints `/tmp/drovr-remote`, and the fake `claude` log gains nothing for it. Given an SSH workspace whose fake ssh fails only on its second connection (`FAKE_SSH_FAIL_AFTER=1`), splitting a running card leaves the new pane showing its error and `SSH failed`, until the user clicks its `Close pane`.
- **AC9 – No `board` remotely:** Given running SSH card `api`, when the user runs `board status . hi` in it, then the terminal shows `command not found` and the tile does not read `Running · hi`.
- **AC10 – Local workspaces unchanged:** the existing smoke tests (`e2e/*.spec.ts`) pass without changes besides the dialog's Location choice defaulting to `This computer`.
- **AC11 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – SSH workspaces in the model, dialog and file:** core host rule (D2) and remote directory rule (D3), unit-tested; `host` on workspaces and cards in the store (copied to cards at creation, D1), in the workspace form's validation and name default (D4), and in saved-state reading and writing (D10), unit-tested with old files and bad hosts; the dialog's Location choice and Host field, the picker hidden for SSH; the sidebar tooltip (D11). New `e2e/ssh.spec.ts`. Satisfies AC1, AC3 (the dialog and file parts), AC10.
2. **S2 – SSH cards connect:** core function building the local shell's `-c` line and remote command from host and directory with the D5 quoting (unit-tested: spaces, quotes, `~`, `~/x`, `$` in a path); `terminal:spawn`'s host argument through shared API, preload and main, with D12's refusals and no `board` variables for SSH spawns; core ready-marker watcher (marker split across chunks, never seen, seen twice) gating the start line for SSH cards in the card sessions (D6); `SSH failed` run state and label (D7) from exit code 255 and the last output line; the header location line (D11); the fake `ssh` helper. Satisfies AC2, AC3, AC4, AC5, AC6, AC7, AC9.
3. **S3 – Panes over SSH and docs:** extra panes of SSH cards spawn with the card's host and no start line; an extra pane's 255 exit keeps it with `SSH failed` (D8). `CONTEXT.md` gains **SSH workspace** (host, remote directory, cards keep their host; not a sync) and **SSH failed** (vs Stopped and Couldn't start); `AGENTS.md`'s smoke-test list names `e2e/ssh.spec.ts`; a follow-up idea is created for `board` in SSH cards (socket forwarding and a remote CLI). Satisfies AC8, AC11.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (host and directory rules, workspace form) + e2e | Create the workspace in the dialog; read sidebar entry and tooltip; try the bad inputs and read the inline errors |
| AC2 | unit (store copies host to cards) + e2e | Edit the host; create `b`; reopen `a`; read the fake ssh log |
| AC3 | unit (saved-state) + e2e | Restart through `e2e/launch.ts` with the same data dir; read the edit dialog, the ssh log, `drovr-state.json`; seed an old file and a bad one |
| AC4 | unit (command builder) + e2e | Open the card; run `pwd` and `echo $DROVR_CARD_ID`; read header and tile |
| AC5 | unit (marker watcher) + e2e | Fake ssh with delay; read the claude log, the screen buffer and the tile |
| AC6 | unit (run state from exit 255) + e2e | Open a card on `unreachable` and on `/nope/remote`; read tiles; `exit`; Close |
| AC7 | unit (spawn refusals) + e2e | Call `window.drovr.terminal.spawn` from the page; check `/tmp/pwned` |
| AC8 | e2e | Split right; read the ssh and claude logs and the pane's `pwd`; failing second connection |
| AC9 | e2e | Run `board status` in the SSH card; read the buffer and the tile |
| AC10 | e2e | Existing smoke suite |
| AC11 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS, against a real host from their `~/.ssh/config`, that a card connects, a passphrase prompt can be answered in the card, and a Claude Code card resumes on the remote machine.

## Stack changes

None: the user's own `ssh` runs in the existing node-pty sessions; no new dependency or service.

## Data and migrations

`drovr-state.json` stays version 1. Workspaces and cards gain an optional `host` string, written only for SSH ones; existing files have none and load as local (D10). `drovr-settings.json` is unchanged.

## Out of scope

- `board` inside SSH cards (socket forwarding, a remote CLI): a follow-up idea.
- Checking the host or the remote directory from the dialog; a remote folder picker.
- Storing passwords, keys or any credential; separate user, port or key fields (use `~/.ssh/config`).
- Remote login shells that aren't POSIX-like (e.g. fish as the remote login shell).
- Reconnecting automatically after a dropped connection; keeping remote processes alive across disconnects (users can run `tmux` in their startup command).
- Moving an existing card to another host or directory.
- Syncing boards between machines (#13).

## Open questions

None.
