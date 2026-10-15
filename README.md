# Drovr

A kanban board for macOS and Linux where every card is a live terminal, for running many coding agents side by side.

## Install

Download the files from the [latest release](https://github.com/alibasharali/drovr/releases).

- **macOS:** `drovr-<version>.dmg`. It is unsigned, so macOS blocks the first launch: allow it under System Settings, Privacy & Security, Open Anyway.
- **Linux (x64):** a .deb or an AppImage.
  - `drovr-<version>-amd64.deb` (Debian, Ubuntu): `sudo apt install ./drovr-<version>-amd64.deb`. It installs Drovr in the app menu and the `drovr` command, and sets up Chromium's sandbox (an AppArmor profile where user namespaces are restricted). On Ubuntu 23.10 and later, the .deb is the way to run Drovr sandboxed.
  - `drovr-<version>-x86_64.AppImage` (any distribution): `chmod +x` it and run it. Where unprivileged user namespaces are restricted (Ubuntu 23.10 and later), the AppImage's launcher starts Drovr without Chromium's sandbox; use the .deb there to keep it. The AppImage needs FUSE 2: `sudo apt install libfuse2` (`libfuse2t64` on Ubuntu 24.04 and later).

## The `board` command

Inside a card's terminal, the agent (or you) can update the board:

- `board move <card> <column>` moves a card to the bottom of a column, e.g. `board move . Done`.
- `board status <card> <text>` shows a short status line on a running card; `""` clears it.

`<card>` is a card's title or id in the same workspace, or `.` for the card you are in. `board` works only inside a Drovr card: Drovr puts it on the card's PATH, so there is nothing to install. If a shell profile reorders PATH (macOS `path_helper` in a login shell), `"$DROVR_BIN/board"` calls it whatever PATH says. `board help` prints the usage.

## Third-party notices

Drovr bundles terminal colour themes from iTerm2-Color-Schemes and the Symbols Nerd Font. Their licences are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES), which also ships inside the app.
