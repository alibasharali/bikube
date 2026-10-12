# Progress #1 PoC: terminal in Electron

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f1eb76e..1cd550e` | CLEAN | Scripts: dev, build, start, typecheck, lint, test (vitest run, src/**/*.test.ts), format, dist, pack. Layout: src/main, src/preload (window.drovr: DrovrApi in src/shared/api.ts, only platform), src/renderer/src (React), src/core (no Electron imports). Window: contextIsolation, sandbox, no nodeIntegration. CI job check: setup-node 22, npm ci, check.sh. Caveat: postinstall electron-builder install-app-deps rebuilds node-pty for Electron, so Node-side Vitest with real PTYs hits ABI mismatch: S3 must handle. Sandbox: npm ci needs --ignore-scripts (proxy blocks Electron headers) |
| S2 | done | factory calls only | n/a | Ideas #2-#15 created, one per Later line in order (#2 Workspaces, #3 Columns, #4 Cards, #5 Resume, #6 Drag/drop, #7 Close, #8 Persistence, #9 board CLI, #10 Themes, #11 Split panes, #12 SSH, #13 Sync, #14 Linux/Windows, #15 Signing) |
| S3 | review | `e31da42..7d4592a` | HUMAN: IPC handlers in src/main/terminals.ts trust renderer args (guards + sender check?) | SessionManager (src/core/session-manager.ts: spawn({cols,rows,shell?,cwd?}) -> {id,pid}, write, resize, kill, killAll, on('data'|'exit')); IPC channels terminal:spawn/write/resize/kill/data/exit in src/shared/api.ts; window.drovr.terminal; Terminal.tsx (data-testid terminal/toolbar, .__xterm); e2e/terminal.spec.ts, npm run test:smoke; node-pty is N-API so one binary serves Vitest and Electron |
| S4 | todo | | | |
| S5 | todo | | | |
| S6 | todo | | | |
| S7 | todo | | | |

## Rulings

None yet.

## Verification

- todo
