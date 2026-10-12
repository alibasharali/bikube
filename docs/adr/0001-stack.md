# 0001: Stack

Status: accepted (item 1)

## Context

Drovr is a macOS kanban board where every card is a live terminal. The premise rests on an xterm.js + node-pty terminal that resizes, renders colours, copies and pastes, and stays fast with many terminals open. The factory registry has no desktop option.

## Decision

- **D1:** Electron + TypeScript, electron-vite (Vite) for build, React for the renderer, xterm.js with the fit and WebGL addons, node-pty, Vitest, ESLint, npm, electron-builder for the .dmg. Same combination VS Code's terminal uses; chosen over vanilla TypeScript and Tauri.
- **D2:** The stack is described in words in `.factory/stack.json` (category `native-ui`); hosting, database and auth are `none`. It is proposed to the registry in the last slice of item 1.
- **D5:** Session and PTY logic lives in plain TS under `src/core` with no Electron imports, so Vitest tests it on Linux. Electron behaviour gets a smoke test under xvfb.
- **D6:** node-pty runs in the main process; the renderer reaches it only through a typed preload bridge (`window.drovr`, type in `src/shared/api.ts`) with `contextIsolation` on, `nodeIntegration` off and the renderer sandboxed.
- **D10:** Nothing rules out Linux or Windows builds: no macOS-only APIs outside packaging and window chrome.

## Consequences

- node-pty is a native module: `postinstall` runs `electron-builder install-app-deps` to rebuild it for Electron, and `electron-builder.yml` unpacks it from the asar. Unit tests under Node and the Electron app therefore need separate builds of the module; later slices handle that where it bites.
- Persistence is deliberately undecided (SQLite vs JSON file, its own item).
- The .dmg is unsigned until an Apple Developer account exists.
