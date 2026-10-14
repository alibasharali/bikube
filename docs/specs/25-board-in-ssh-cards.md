---
item: 25
type: feature
title: "`board` command inside SSH cards"
status: approved
branch: claude/25-board-in-ssh-cards
---

# `board` command inside SSH cards

## Problem

An agent in a local card can move its card or set its status line with `board` (#9), but an agent in an SSH card (#12) can't: the CLI runs on Drovr's own executable as Node, which the remote machine doesn't have, so `board` there is `command not found` (#12 D9). For a developer whose agents run on a dev box, the board's columns and status lines then say nothing about the remote work. After this ships, `board` works inside every SSH card and its extra panes exactly as in a local card: the same commands, replies and errors, through a Unix socket forwarded by the user's own `ssh`, with a small remote client that needs only `perl` or `python3` on the host. This replaces #12 D9; everything else in #9 and #12 stands.

## Domain decisions

- **D1 – Transport:** each SSH session (a card's main pane or an extra pane, #12 D5, D8) forwards a Unix socket with the user's own `ssh`: `ssh -R <remote socket>:<local socket> -t -- <host> <remote command>`. Requests and replies use #9's protocol unchanged (D6: one JSON line each way, version 1), and main relays them to the window as for local cards (#9 D10). Nothing is written to the terminal. *Why:* round 1 Q1; replies carry the errors agents recover from, and an in-band escape sequence could be fired by `cat`-ing a crafted file and would mix with the agent's own terminal input.
- **D2 – A socket per SSH session:** before starting an SSH session, main listens on a new local socket `s-<16 random hex>.sock` in the private `board` directory next to `board.sock` (#9 D5: same `0700` directory checks, socket mode `0600`, same connection cap, line limit and timeouts). It serves only requests whose `cardId` is that session's card: any other `cardId` is answered `board: invalid request` and never reaches the window. Main closes it and removes its file when the session exits, when its page reloads or its window closes (its sessions are killed), and on quit; at startup it removes leftover `s-*.sock` files in the `board` directory. The local shell that runs `ssh` still gets none of the `board` variables (#12 D5). *Why:* round 1 Q3; whoever can reach the forwarded socket on the remote host can act only as that card (its siblings included, #9 D2, as from inside the card), never as another card or workspace.
- **D3 – Remote socket path:** `/tmp/drovr-<32 random hex>.sock` (128 bits from a cryptographic source in main), new for every session. OpenSSH creates it owned by the remote user with mode `0600` (its default `StreamLocalBindMask`). The remote client connects only to a socket owned by the remote user (D7). *Why:* round 1 Q4; the path must be fixed before the remote command runs, `/tmp` exists on every host, and an unguessable name can neither be squatted nor collide with a stale one.
- **D4 – Remote setup:** the remote command (#12 D5) becomes, for a POSIX remote login shell: `cd <dir> || exit 255`; then, without ever printing anything or failing the session, create a private directory with `umask 077` and `mktemp -d "${TMPDIR:-/tmp}/drovr.XXXXXXXX"`, write the `board` script (D5) into it, mode `0700`; export `DROVR_CARD_ID` (the card's id), `DROVR_SOCKET` (the D3 path), `DROVR_BIN` (the private directory) and `PATH` with it first; then print the ready marker and run the remote login shell as today (exit status 255 reported as 254). When `mktemp` is missing or fails, the shell starts without `DROVR_BIN` and the `PATH` change, so `board` is not found, but `DROVR_CARD_ID` and `DROVR_SOCKET` are still set. When the remote shell exits, and when the session hangs up (`HUP`) or is terminated (`TERM`), the private directory and the remote socket file are removed. The exit status rules of #12 D5 and D7 are unchanged: only `ssh` itself and the failed `cd` give 255. *Why:* round 1 Q4; nothing persists on the host after a session, and a missing tool never costs the user their terminal.
- **D5 – Remote client:** the remote `board` is a POSIX `sh` script that runs an embedded client with `perl` when `perl` is on `PATH`, else with `python3`, else prints `board: needs perl or python3 on this host` to stderr and exits 1. Both clients are generated in core from the same constants as the local CLI (usage text, error strings, protocol version, 5 s answer timeout) and behave exactly like it (#9 D1, D9): `board`, `board help`, `board --help` print the usage to stdout, exit 0; any other shape prints it to stderr, exit 2; success prints nothing, exit 0; a refusal prints `board: <reason>` to stderr, exit 1. They use only modules that ship with the language (`IO::Socket::UNIX` for perl; `socket`, `json`, `os`, `sys` for python3) and read UTF-8 arguments. The whole remote command, clients included, contains no backslash except the ready marker's existing `printf` escapes, and never a backslash followed by a backslash or a single quote, so the D5 line quotes the same under any local login shell, fish included (#12 D3). *Why:* round 1 Q2; perl is on macOS and every Debian/Ubuntu, python3 on Fedora/RHEL; perl first because macOS's `python3` is often an Xcode install stub.
- **D6 – Errors specific to SSH cards:** `board: can't reach Drovr from this host` (exit 1) when `DROVR_SOCKET` is set but is not a socket owned by the remote user, or connecting to it fails; `board: not running inside a Drovr card` when `DROVR_CARD_ID` or `DROVR_SOCKET` is missing (#9 D3); `board: no answer from Drovr` after 5 s or on a missing or invalid reply (#9 D9). Every other error comes from main or the window, word for word as for a local card. *Why:* round 1 Q5, Q7.
- **D7 – Forwarding refused or not listening:** when the host refuses socket forwarding (`AllowStreamLocalForwarding no`) or main can't listen on the session's local socket, the card still starts and runs normally: `ssh` prints its own warning (e.g. `Warning: remote port forwarding failed for listen path …`) in the terminal when the host refuses, and when main can't listen it starts `ssh` without `-R`; `board` there reports D6's `can't reach`. Never `SSH failed` on that account. *Why:* round 1 Q5; a missing `board` must never cost the user their remote terminal.
- **D8 – Always on:** every SSH card's main pane and extra panes get `board`; there is no setting. A host that refuses forwarding shows `ssh`'s one-line warning at each connection, which `LogLevel ERROR` for that host in `~/.ssh/config` silences. *Why:* round 1 Q6; the same as local cards, nothing persists on the host.
- **D9 – Security:** no new IPC; `terminal:spawn` keeps its arguments and refusals (#12 D12). The renderer never sends a socket path or a command: main picks both random names, builds the line in core from the re-checked host and directory, and the card id it already checked (#9 D3). contextIsolation on, nodeIntegration off, sandbox on. *Why:* AGENTS.md; the renderer is untrusted.

## Acceptance criteria

The smoke tests extend #12's fake `ssh`: for `-R <remote>:<local>` it creates `<remote>` as a symlink to `<local>` (the forward), unless `FAKE_SSH_NO_FORWARD=1`, when it prints `Warning: remote port forwarding failed for listen path <remote>` and creates nothing. The fake remote's `PATH=/usr/bin:/bin` has `perl` and `python3` on CI.

- **AC1 – `board` in an SSH card:** Given SSH workspace `remote` (`me@devbox`, `/tmp/drovr-remote`, columns Backlog, Running, Needs me, Done) with running card `api`, when the agent runs `board status . hi`, then the tile reads `Running · hi`; `board move . Done` moves `api` to the bottom of Done while it keeps running; `echo $DROVR_CARD_ID` prints `api`'s id; `"$DROVR_BIN/board" help` prints the usage. The fake ssh log shows `-R /tmp/drovr-<32 hex>.sock:<data dir>/board/s-<16 hex>.sock` before `-t -- me@devbox`.
- **AC2 – Same errors as local:** in the same card, `board move . Nope` prints `board: no column "Nope"; columns are: Backlog, Running, Needs me, Done` and `echo $?` prints `1`; `board move` with no more arguments prints the usage and exits 2; with a second running card `web`, `board status web hey` makes `web` read `Running · hey`.
- **AC3 – Only its own card:** in card `api`, `DROVR_CARD_ID=<web's id> board status . x` prints `board: invalid request` and `web`'s tile is unchanged.
- **AC4 – Extra panes:** given running SSH card `api` split right, `board status . pane` typed in the new pane makes the tile read `Running · pane`, and the fake ssh log's line for the pane has its own `-R` with different remote and local paths.
- **AC5 – Cleanup:** given running SSH card `api`, when the user types `exit` in it, then the card is `Stopped`, its remote socket path (from the ssh log) and its `$DROVR_BIN` directory no longer exist, and its local `s-*.sock` is gone. When Drovr quits with SSH cards running, no `s-*.sock` is left in `<data dir>/board`; a leftover `s-old.sock` placed there before launch is gone after launch.
- **AC6 – Forwarding refused:** given `FAKE_SSH_NO_FORWARD=1`, a new SSH card reads `Running`, shows the warning, and `board status . hi` prints `board: can't reach Drovr from this host`, exit 1.
- **AC7 – Remote client, both languages:** (unit) the generated remote `board` script, run with `sh` under a `PATH` holding only `perl`, then only `python3`, against a real board socket server: a status request arrives with the right card id and command and exit 0; an error reply prints `board: <error>` and exits 1; help prints the usage, exit 0; a wrong shape prints the usage to stderr, exit 2; a socket that doesn't answer gives `board: no answer from Drovr` after the timeout; a missing socket path and a path that isn't a socket give `can't reach`; a missing `DROVR_CARD_ID` gives `not running inside a Drovr card`; a status text with a quote, a backslash, a newline and `é` arrives unchanged. Under a `PATH` with neither, it prints `board: needs perl or python3 on this host`, exit 1.
- **AC8 – Fish-safe line:** (unit) the SSH line for any valid host and directory contains no backslash followed by a backslash or a single quote, and the embedded clients contain no backslash at all; the remote command still starts with `cd <dir> || exit 255; ` and keeps the 255→254 mapping.
- **AC9 – Session socket scope:** (unit) a session socket answers a request for another card id with `board: invalid request` without calling the window, relays its own card's requests, and is closed and its file removed when the session exits.
- **AC10 – Unchanged elsewhere:** local cards' `board` (`e2e/board-cli.spec.ts`) and every other smoke test pass unchanged, except `e2e/ssh.spec.ts`'s #12 AC4 (`DROVR_CARD_ID` now set remotely; the local ssh process still has no `board` variables) and AC9 (replaced by AC1). A remote shell whose `cd` fails is still `SSH failed` (#12 AC6).
- **AC11 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Remote client and remote command:** core generators for the perl and python3 clients and the remote `board` script (D5, D6) from the local CLI's constants; the SSH line builder gains the forward (`-R`) and the D4 setup and cleanup from the card id and the two socket paths, or none of the forward when no local socket is given (D7), with unit tests running the script under `sh`, `perl` and `python3` against `startBoardServer` and checking the quoting rule. Satisfies AC7, AC8.
2. **S2 – Session sockets in main and SSH cards in the app:** a per-session board server scoped to its card (D2), random paths (D3), started before an SSH spawn and closed with its session, its page, its window and on quit, leftovers removed at startup; `terminal:spawn` passes them to the line builder; the fake `ssh` gains `-R` and `FAKE_SSH_NO_FORWARD`; `e2e/ssh.spec.ts` gains AC1–AC6 and updates #12 AC4 and AC9. `CONTEXT.md` (**Board command**, **Pane**, **SSH workspace**: remote cards have `board`), `AGENTS.md` (architecture note on `board` in SSH cards, the ssh smoke list) and #12's spec note that D9 is replaced by #25. Satisfies AC1–AC6, AC9, AC10, AC11.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | SSH card through the fake ssh; run `board status`, `board move`, read tiles and columns, `echo $DROVR_CARD_ID`, the ssh log |
| AC2 | e2e | Run the bad commands in the SSH card; read the buffer and `$?` |
| AC3 | unit + e2e | Override `DROVR_CARD_ID` in the SSH card; read output and `web`'s tile |
| AC4 | e2e | Split right; `board status` in the new pane; read tile and ssh log |
| AC5 | e2e | `exit`; check the remote paths and `<data dir>/board`; quit; seed `s-old.sock` and launch |
| AC6 | e2e | `FAKE_SSH_NO_FORWARD=1`; read tile, buffer and `$?` |
| AC7 | unit (Vitest spawning `sh` with a restricted PATH against `startBoardServer`) | — |
| AC8 | unit (SSH line builder) | — |
| AC9 | unit (session socket server) | — |
| AC10 | e2e | Existing smoke suite |
| AC11 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks on macOS against a real host that `board status . hi` in an SSH card changes the tile, and that after `exit` nothing named `drovr-*` is left in the host's `/tmp`.

## Stack changes

None: the user's own `ssh` forwards the socket; the remote client uses `perl` or `python3` already on the host. No new dependency or service.

## Data and migrations

None. Saved state and settings are unchanged; sockets and the remote directory are runtime only.

## Out of scope

- A setting to turn `board` off for SSH cards.
- Hosts with neither `perl` nor `python3` (a static helper binary, `nc -U` or `socat` fallbacks).
- Remote login shells that aren't POSIX-like (as #12).
- Cleaning stale `drovr-*` files on a host after a session was killed with `SIGKILL` or the host rebooted (`/tmp` is cleared on reboot on most hosts).
- New `board` commands.

## Open questions

None.
