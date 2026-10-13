# AGENTS.md

Drovr: A macOS kanban board where every card is a live terminal, for running many coding agents side by side.

Built with Software Factory's workflow: read `docs/agents/workflow.md` before starting on an item, and `docs/agents/stack.md` for the stack picked at creation and its guidelines. Domain terms are in `CONTEXT.md`, decisions in `docs/adr/`.

## Commands

- `npm ci` installs; `postinstall` rebuilds node-pty for Electron (needs python3, make and a C++ compiler on Linux). Where the Electron headers download is blocked (cloud sessions: postinstall fails with a proxy 403), everything else is installed by then: run `npm rebuild node-pty`; the Node build works in Electron too (N-API, ADR 0001).
- `npm run dev` starts the app with hot reload; `npm start` previews the production build.
- `.claude/check.sh` runs everything that must be green: typecheck, lint, Vitest, build, `node .factory/check-stack.mjs`. CI's `check` job runs it.
- Individually: `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run build`, `npm run format`.
- `npm run test:smoke` builds, then runs the Playwright-Electron smoke tests in `e2e/` (window, empty state, workspace create/validate/switch/edit/delete, columns, sidebar collapse, keyboard: `e2e/board.spec.ts`; cards create/open/back/status/Stopped and restart/rename/delete: `e2e/cards.spec.ts`; startup commands (new-card select, workspace default, card menu, tags, Claude Code resume with a fake `claude`): `e2e/startup.spec.ts`; navigation lock and terminal lifecycle: `e2e/lifecycle.spec.ts`; keyboard, menu and drag moves of cards: `e2e/moves.spec.ts`; closing a card from its menu and the full-size view, cancel, resume after closing, not offered when not running, deletes after closing: `e2e/close.spec.ts`; the board surviving a restart, restored cards Stopped, resume after a restart, SIGKILL, unreadable state file, launch view, one instance per data directory: `e2e/persistence.spec.ts`; the `board` command typed in a card (self and sibling moves, errors, other workspaces, usage, outside a card, the socket's mode and lifetime, bad requests): `e2e/board-cli.spec.ts`; the fake `claude` setup is shared in `e2e/fake-claude.ts`; every test launches through `e2e/launch.ts`, which gives it its own `DROVR_USER_DATA_DIR` and removes it with `removeDataDirs()` after the test). Needs a display: `xvfb-run -a npm run test:smoke` on Linux. CI runs it after `check.sh`.
- `npm run benchmark` builds, then runs the 10-terminal performance benchmark (`e2e/benchmark.spec.ts`, `playwright.benchmark.config.ts`): 10 cards in one workspace, all streaming, one open at full size; writes `test-results/benchmark-<profile>.md`. Needs a display: `xvfb-run -a npm run benchmark`; `BENCH_PROFILE=firehose` for the stress profile.
- `npm run dist` builds the unsigned macOS .dmg (macOS only); `npm run pack` builds an unpacked app for the current OS.
- CI also runs `actionlint` (via `check.sh`; install with `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`). `.github/workflows/release.yml` builds the .dmg on a published release and attaches `dist/*.dmg`.
- Headless launch: `xvfb-run -a npx electron . --no-sandbox` (after `npm run build`).

## Architecture

- `src/main` Electron main process; `src/preload` the only bridge to the renderer, typed by `src/shared/api.ts` (`window.drovr`); `src/renderer` React UI; `src/core` plain TS with no Electron imports (session/PTY logic), unit-tested with Vitest on Linux.
- `board` (#9): inside a card's terminal (only there), an agent runs `board move <card> <column>` or `board status <card> <text>` (`.` is the calling card; `board help`). `resources/bin/board` (a POSIX sh wrapper; its directory is prepended to PATH in the environment of every card's shell) runs `out/main/board-cli.js` (built from `src/main/board-cli.ts`) with Drovr's own executable as Node; it talks to main over `<userData>/board.sock`, and main forwards each request to the renderer, which applies it to the store. Packaged, `bin/` is in `extraResources` and the CLI module and its chunks are unpacked from the asar (`electron-builder.yml`); after `npm run pack`, `dist/linux-unpacked/resources/bin/board` must be executable and `resources/app.asar.unpacked/out/main/board-cli.js` must exist.
- Window settings: contextIsolation on, nodeIntegration off, sandbox on. Don't weaken them.
- No macOS-only APIs outside packaging and window chrome (Linux and Windows builds stay possible).
- Stack and decisions: `docs/adr/0001-stack.md`. Never deploy by hand; releases come from a GitHub release workflow.

This file is for every coding agent; `CLAUDE.md` imports it.
