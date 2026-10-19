# Progress #49 Detect dev-server ports and open them

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `9d6278b..e6028ab` | CLEAN | `DevServers` (src/core/dev-servers.ts; app instance `devServers()` in src/renderer/src/dev-servers.ts): `paneOpened/output/paneEnded(cardId,paneId)` (cardEnded removed in review), `ports`, `subscribe`; `MAIN_PANE`. `CardSessions.watchOutput` feeds local main panes. IPC `ports:probe` → `window.drovr.ports.probe`. `<DevServerChips cardId>` (testids dev-servers, dev-server-chip, dev-server-more). |
| S2 | done | `3fb721b..10c03d4` | CLEAN | `CardPanes.watchOutput(PaneOutputWatcher)` feeds local extra panes; shell chips in ShellStrip. |

## Rulings

- 2026-10-19: grilling round 1 answered by full auto with the recommendations (see the spec).

- 2026-10-19 S1: D3 "the first pane that printed a port keeps it" read as first in time (orchestrator).

## Verification

- done: ALL PASS (e2e 8/8, Vitest seams)
