<!-- software-factory:readme -->

# Drovr

A kanban board for macOS and Linux where every card is a live terminal, for running many coding agents side by side.

## What it does

- **Workspaces**, typically one per repo, each with a name, a working directory and its own board of columns you add, rename, reorder and delete.
- **Cards as terminals**: each card is a real login shell. Open one to use it at full size; on the board it shows its title and status. Drag cards between columns or move them from the keyboard or the card menu; moving never stops the process. Close stops a card's process after asking, and the card can be opened again later.
- **Startup commands and agent resume**: a card can start `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, a custom command or a plain shell, and reopening an agent card resumes the agent's session (for Codex, Gemini CLI and OpenCode, the latest one in the card's directory). The board survives a restart, with every card stopped until opened.
- **Split panes**: up to 4 terminals side by side or stacked inside a card.
- **Settings and themes**: System, Dark or Light theme; the terminals' font size and family; the shell new cards start (the login shell, one from `/etc/shells` or any path); a terminal colour theme for the dark and the light theme, picked from 463 Ghostty themes with a live preview, or the colours of your own Ghostty config; the shortcuts of an open card (back to the board, split, close pane, close card) and of Settings. Prompt icons (Nerd Font glyphs) work out of the box.
- **SSH workspaces**: cards run on another machine through your own `ssh`, in a directory on that host.
- **Sync folder**: pick a folder your own sync tool (iCloud Drive, Dropbox, Syncthing…) carries between machines, and the board follows you.
- **The `board` command**: inside a card's terminal, the agent (or you) can update the board:
  - `board move <card> <column>` moves a card to the bottom of a column, e.g. `board move . Done`.
  - `board status <card> <text>` shows a short status line on a running card; `""` clears it.
  - `board activity <card> working|waiting|question|none` shows a Working, Waiting for you or Needs your answer pill on a running card; `none` clears it. Claude Code cards set it, and their status line, by themselves.

  `<card>` is a card's title or id in the same workspace, or `.` for the card you are in. `board` works only inside a Drovr card: Drovr puts it on the card's PATH, so there is nothing to install. If a shell profile reorders PATH (macOS `path_helper` in a login shell), `"$DROVR_BIN/board"` calls it whatever PATH says. `board help` prints the usage.

## Links

- [Releases](https://github.com/alibasharali/drovr/releases)

## Install

Download the files from the [latest release](https://github.com/alibasharali/drovr/releases).

- **macOS (Apple silicon):** `drovr-<version>.dmg`. Drag Drovr to Applications. It isn't signed with an Apple Developer ID, so macOS blocks the first launch: allow it under System Settings, Privacy & Security, Open Anyway.
- **Linux (x64):** a .deb or an AppImage.
  - `drovr-<version>-amd64.deb` (Debian, Ubuntu): `sudo apt install ./drovr-<version>-amd64.deb`. It installs Drovr in the app menu and the `drovr` command, and sets up Chromium's sandbox (an AppArmor profile where user namespaces are restricted). On Ubuntu 23.10 and later, the .deb is the way to run Drovr sandboxed.
  - `drovr-<version>-x86_64.AppImage` (any distribution): `chmod +x` it and run it. Where unprivileged user namespaces are restricted (Ubuntu 23.10 and later), the AppImage's launcher starts Drovr without Chromium's sandbox; use the .deb there to keep it. The AppImage needs FUSE 2: `sudo apt install libfuse2` (`libfuse2t64` on Ubuntu 24.04 and later).

### Updates

Drovr checks the latest release at launch and every few hours (Settings, About, Check for Updates, or Drovr › Check for Updates… on macOS). When there is a newer one, **Update Available** shows above Settings: on macOS and with the AppImage, Drovr downloads it, checks it against the checksum GitHub publishes, and **Install and Relaunch** replaces the app and opens it again (running terminals are stopped first; it asks). **Later** installs it the next time you quit Drovr; **Skip** ignores that version. On macOS Drovr replaces the inside of its own `Drovr.app`, so it updates in Applications on a standard (non-admin) account too; an AppImage needs a folder you can write. The .deb, and a copy Drovr can't replace, link to the release to download it instead.

## Running it locally

- `npm ci` installs the dependencies and rebuilds node-pty for Electron (on Linux it needs python3, make and a C++ compiler).
- `npm run dev` starts the app with hot reload; `npm start` previews the production build.
- `.claude/check.sh` runs typecheck, lint, the unit tests, the build, the stack check, and actionlint on the workflows when it is installed.
- `xvfb-run -a npm run test:smoke` runs the end-to-end tests on Linux (without `xvfb-run` where there is a display).
- `npm run dist` builds the release packages for the OS it runs on, in `dist/`.

## Working on it

Read `AGENTS.md` and `docs/agents/workflow.md` before starting.

## Third-party notices

Drovr bundles terminal colour themes from iTerm2-Color-Schemes and the Symbols Nerd Font. Their licences are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES), which also ships inside the app.

## Built with Software Factory

Drovr is created and managed by Software Factory.

> Software Factory is a personal control plane for software projects: it scaffolds or imports each repo, tracks work on a per-project board, and has Claude Code sessions take each item from spec to pull request, while the developer approves specs and decides what ships.
