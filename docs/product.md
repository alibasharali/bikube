# Drovr

What this product is and why, kept true as it evolves. Planned work lives on the factory board as items; this file holds the direction. When an item changes it (something added, cut or rethought), update this file in the same PR.

## Description

As the developer wrote it when creating the project. Rewrite it when the direction changes.

A kanban board for macOS and Linux where every card is a live terminal, for running many coding agents side by side.

Who it's for: a developer who runs several terminal sessions at once (Claude Code, dev servers, test watchers) across several repos, and loses track of which window is doing what. Instead of a pile of terminal tabs, they get a board: each card is a real terminal, and its column says what state that work is in.

v1, what a user can do:
- Create workspaces, typically one per repo. A workspace has a name and a working directory; every terminal in it starts there.
- Each workspace has its own board with columns the user defines: add, rename, reorder and delete columns (sensible defaults: Backlog, Running, Needs me, Done).
- Create cards. A card is a terminal session (a real shell via a PTY, running the user's login shell) with a title. Open a card to use the terminal at full size; on the board, cards show their title and a one-line status (running, exited, last output line).
- Resume where you left off when opening the terminal (for agents at least). This can be done by maybe having a "startup" command that runs if the terminal is not "open", like claude --resume <id>.
- Drag cards between columns and reorder them. Moving a card never stops its process.
- Close a card: it asks before killing a running process, but can always be resumed if willing to pick that item up again.
- Everything persists across app restarts: workspaces, columns, cards and their positions, each card's working directory and title. Terminal processes don't survive a restart; a card whose process is gone shows as exited and can be restarted in the same directory, see the resume point above.
- Agents can move cards: a small local command-line tool (e.g. `board move <card> <column>`, `board status <card> "<text>"`) that a program running inside a card can call to move itself or set its status line. It talks to the running app over a local socket and only accepts connections from the same user.

Not in v1 (future points/ideas): themes and settings beyond the basics, split panes inside a card, SSH or remote workspaces, syncing between machines, Windows builds (but don't make choices that rule them out), and more?...

Stack: Electron with xterm.js for the terminal view and node-pty for the processes, the same combination VS Code's terminal uses. TypeScript throughout. Store app data locally (e.g. SQLite or a JSON file in the app's data directory). Keep the UI, the board logic and the PTY handling testable on Linux, because development happens in Linux cloud sessions; only packaging, signing and window behaviour are macOS-only. Sound good? Missing something?

First slice: a spike that proves an xterm.js + node-pty terminal runs inside Electron with correct resize, colours, copy and paste, and acceptable performance with 10 terminals open, before the board is built around it.

Shipping: GitHub releases. A release workflow on a macOS runner builds an unsigned .dmg (signing and notarization come later, once I have an Apple Developer account) and attaches it to the release, and a job on a Linux runner builds an AppImage and a .deb (x64) and attaches them to the same release; the two jobs are independent. Pre-releases are betas I test before a full release.

## Dropped

Ideas considered and left out, with why, so they are not proposed again.

- None yet.
