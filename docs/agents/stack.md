# Stack

Managed by Software Factory from its stack registry; changes here are overwritten. To change a stack's guidelines or skills, use `propose_stack_change` (see the `lesson` skill).

| Category | Choice |
|---|---|
| Native & desktop UI | Electron desktop app, Electron + TypeScript + electron-vite + React + xterm.js (fit, webgl addons) + node-pty + Vitest + ESLint + electron-builder + npm *(not in the registry yet)* |
| Database | none *(not in the registry yet)* |
| Auth | none *(not in the registry yet)* |
| Hosting | none *(not in the registry yet)* |

No recipe matches this combination: the first item scaffolds it from these guidelines.

## Not in the registry yet

The developer described these in words. The first item sets them up, proves they work (build, tests, a dev deploy where there is hosting), and records what it learned for the registry.

- **Native & desktop UI:** Electron + TypeScript + electron-vite + React + xterm.js (fit, webgl addons) + node-pty + Vitest + ESLint + electron-builder + npm
- **Database:** none
- **Auth:** none
- **Hosting:** none

## Electron desktop app

_Updated 2026-10-12._

- Keep logic (sessions, board, storage) in plain TypeScript under `src/core` with no Electron imports, so Vitest tests it on Linux. Electron-only behaviour gets a Playwright-Electron smoke test run under `xvfb-run` in CI, after `check.sh` (it needs a display).
- The renderer is sandboxed with `contextIsolation` on and `nodeIntegration` off. It reaches main only through a typed preload bridge (`window.<app>`, types in `src/shared`). Validate every IPC argument in main at runtime (types, ranges, size caps) and check the sender is the window's main frame; the compile-time types do not protect main.
- Native modules (node-pty, better-sqlite3): `postinstall` runs `electron-builder install-app-deps`; unpack them from the asar (`asarUnpack`). N-API modules such as node-pty 1.x load in both Node and Electron, so Vitest and the app share one binary; a non-N-API module needs its own Node build for Vitest.
- In a sandbox where Electron headers are blocked, `npm ci --ignore-scripts` then `node node_modules/electron/install.js`; if a native module has no prebuild for the platform, `npx node-gyp rebuild` inside it.
- Under software GL (SwiftShader, llvmpipe) xterm's WebGL addon is slower than the DOM renderer: detect the GL renderer string and fall back to DOM; Chromium also caps WebGL contexts at about 16.
- Release: a workflow on `release: published` runs on `macos-latest`, `npm run dist`, and `gh release upload "$TAG" dist/*.dmg --clobber` with the tag passed through `env`, never interpolated into the script. Unsigned until an Apple Developer account exists (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `mac.identity: null`). Pre-releases are betas. Lint workflows with actionlint in `check`.
- Don't use macOS-only APIs outside packaging and window chrome, to keep Linux and Windows builds open. Use Cmd on macOS and Ctrl+Shift elsewhere for terminal copy/paste shortcuts, so Ctrl+C stays the interrupt.

## Docs

Prefer these over memory: APIs move faster than training data.

- [Electron desktop app: Electron](https://www.electronjs.org/docs/latest)
- [Electron desktop app: electron-vite](https://electron-vite.org)
- [Electron desktop app: electron-builder](https://www.electron.build)
