# 0001: Stack

Status: accepted (item 1)

## Context

Bikube is a macOS kanban board where every card is a live terminal. The premise rests on an xterm.js + node-pty terminal that resizes, renders colours, copies and pastes, and stays fast with many terminals open. The factory registry has no desktop option.

## Decision

- **D1:** Electron + TypeScript, electron-vite (Vite) for build, React for the renderer, xterm.js with the fit and WebGL addons, node-pty, Vitest, ESLint, npm, electron-builder for the .dmg. Same combination VS Code's terminal uses; chosen over vanilla TypeScript and Tauri.
- **D2:** The stack is described in words in `.factory/stack.json` (category `native-ui`); hosting, database and auth are `none`. It is proposed to the registry in the last slice of item 1.
- **D5:** Session and PTY logic lives in plain TS under `src/core` with no Electron imports, so Vitest tests it on Linux. Electron behaviour gets a smoke test under xvfb.
- **D6:** node-pty runs in the main process; the renderer reaches it only through a typed preload bridge (`window.bikube`, type in `src/shared/api.ts`) with `contextIsolation` on, `nodeIntegration` off and the renderer sandboxed.
- **D10:** Nothing rules out Linux or Windows builds: no macOS-only APIs outside packaging and window chrome.

## Consequences

- node-pty is a native module: `postinstall` runs `electron-builder install-app-deps` to rebuild it for Electron, and `electron-builder.yml` unpacks it from the asar. node-pty 1.x is built on N-API (`napi.h`), which is ABI-stable across Node and Electron, so the copy built for Node loads in Electron too and Vitest with real PTYs and the Electron app share one binary; there is no ABI mismatch to work around. The rebuild for Electron stays for packaging. If node-pty ever stops using N-API, Vitest needs its own Node build of the module.
- Electron behaviour is covered by a Playwright-Electron smoke test (`npm run test:smoke`, `e2e/`) run under `xvfb-run` after `check.sh` in CI; it is not part of `check.sh` because it needs a display.
- Persistence was left to its own item; see the addendum below.
- The .dmg is signed ad hoc and not notarized until an Apple Developer account exists.

## Addendum: persistence (item 8)

The board is stored as one JSON file, `bikube-state.json` (`{ "version": 1, "state": WorkspaceState }`), in Electron's `userData` directory, owned and written by main atomically (temp file, then rename), at most once every 200 ms and flushed on quit. No SQLite: the state is a few KB, always read and written whole, and better-sqlite3 would add a second native module and a stack change for no query need. `.factory/stack.json` keeps `database: none`. An unreadable file is moved aside as `bikube-state.corrupt-<timestamp>.json`. `BIKUBE_USER_DATA_DIR` overrides `userData` so smoke tests each get their own board. See `docs/specs/8-persistence.md` (D2).
