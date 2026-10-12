# Progress #1 PoC: terminal in Electron

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f1eb76e..1cd550e` | CLEAN | Scripts: dev, build, start, typecheck, lint, test (vitest run, src/**/*.test.ts), format, dist, pack. Layout: src/main, src/preload (window.drovr: DrovrApi in src/shared/api.ts, only platform), src/renderer/src (React), src/core (no Electron imports). Window: contextIsolation, sandbox, no nodeIntegration. CI job check: setup-node 22, npm ci, check.sh. Caveat: postinstall electron-builder install-app-deps rebuilds node-pty for Electron, so Node-side Vitest with real PTYs hits ABI mismatch: S3 must handle. Sandbox: npm ci needs --ignore-scripts (proxy blocks Electron headers) |
| S2 | done | factory calls only | n/a | Ideas #2-#15 created, one per Later line in order (#2 Workspaces, #3 Columns, #4 Cards, #5 Resume, #6 Drag/drop, #7 Close, #8 Persistence, #9 board CLI, #10 Themes, #11 Split panes, #12 SSH, #13 Sync, #14 Linux/Windows, #15 Signing) |
| S3 | done | `e31da42..f96e98c` | CLEAN after fix round (HUMAN ruling applied) | SessionManager (src/core/session-manager.ts: spawn({cols,rows,shell?,cwd?}) -> {id,pid}, write, resize, kill, killAll, on('data'|'exit')); IPC channels terminal:spawn/write/resize/kill/data/exit in src/shared/api.ts; window.drovr.terminal; Terminal.tsx (data-testid terminal/toolbar, .__xterm); e2e/terminal.spec.ts, npm run test:smoke; node-pty is N-API so one binary serves Vitest and Electron |
| S4 | done | `1e3295c..19b93ac` | CLEAN | window.drovr.clipboard.read()/write(text) (IPC clipboard:read/write, guarded, main-frame sender); src/core/clipboard.ts (clipboardShortcut, copySelection, pasteFromClipboard); Terminal.tsx loads WebglAddon per instance (try/catch, onContextLoss falls back to DOM; Chromium ~16 WebGL context limit matters for S5); shortcuts Cmd+C/V mac, Ctrl+Shift+C/V elsewhere; smoke: `xvfb-run -a npx playwright test` (needs `node node_modules/electron/install.js` after --ignore-scripts install) |
| S5 | done | `d9f1807..0538f22` | CLEAN | Grid + toolbar (testids new-terminal, terminal-count); `xvfb-run -a npm run benchmark` (BENCH_PROFILE=firehose for stress) writes test-results/benchmark-<profile>.md; software-GL detection (src/core/webgl-support.ts) falls back to DOM. Numbers in Verification section. Flow-control idea = #16 |
| S6 | done | `2262c14..9e39b7c` | CLEAN | .github/workflows/release.yml (release published -> macos-latest, npm run dist, gh release upload dist/*.dmg); actionlint 1.7.7 via go install in ci.yml, check.sh fails in CI if missing; dmg named from package.json version (not the tag); `npm run pack` fails in sandbox (proxy blocks Electron headers), `electron-builder --dir --config.npmRebuild=false` works; real macOS run unverified (developer on beta) |
| S7 | done | factory calls only | n/a | propose_stack_change: https://github.com/alibasharali/software-factory/pull/2 (electron-desktop, experimental) |

## Rulings

- S3: developer chose "Harden now": runtime guards (integer cols/rows 1..1000, string id, string data with size cap, drop otherwise) plus sender check, unit-tested. Applied in f96e98c (src/core/ipc-guards.ts). Note: node-pty has no linux-x64 prebuild; Vitest PTY tests need `npx node-gyp rebuild` in node_modules/node-pty in a fresh sandbox.

## Verification

AC8 benchmark (sustained profile, Linux 6.18 x64, 4 vCPU Xeon 2.1 GHz, xvfb, software GL, DOM renderer; NOT macOS; 10 terminals each ~4000 lines/s, 8 s after 2 s warm-up):

| Metric | Value | Budget | Result |
|---|---|---|---|
| Renderer fps (rAF) | 60.0 | >= 30 | PASS |
| Renderer fps, 10 idle shells | 60.6 | n/a | info |
| Longest frame gap | 16.8 ms | n/a | info |
| Input echo to buffer p50 / p95 / max (20 samples) | 1.7 / 16.3 / 16.3 ms | max <= 100 ms | PASS |
| Dropped echoes | 0 | 0 | PASS |
| Main event-loop lag p99 / max | 2.8 / 5.6 ms | p99 <= 100 ms | PASS |
| Sessions producing output | 10 / 10 | 10 / 10 | PASS |

Noise: one earlier run had a 99.9 ms longest frame gap and 104.7 ms main-loop lag max. With software-GL WebGL forced on, fps was 22.3 (FAIL), hence the DOM fallback on software renderers. Firehose profile (unthrottled output): fps 8.4, 16/20 echoes dropped, main lag p99 8.4 ms: no flow control yet (idea #16). WebGL on real hardware not measured: re-run on the macOS beta.

- done: all ACs verified on Linux/xvfb, see post_verification (AC2, AC10 real run: not yet)
