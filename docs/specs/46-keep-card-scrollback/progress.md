# Progress #46 Keep a card's scrollback across restarts

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `bd9ed79..1188112` | fixed r1 | `CardScreen.serialize(rows)`; `OutputKeeper {keeps, scrollback, read, save}` 5th `CardSessions` arg, renderer's `outputKeeper` in card-terminals.ts; `kept-output.ts`: `KeptOutput`, `MAX_KEPT_CHARS`, `keptOutput`, `restoredText`; `ScrollbackStore {read, save, delete}` (sync) returned by `registerScrollback()` in src/main/scrollback.ts; IPC `scrollback:read/save/delete` as `window.drovr.scrollback`; save deleted in `disposeCard`; e2e helper `belowSeparator` in e2e/card-view.ts |
| S2 | done | `1af9675..a7c3301` | CLEAN | `ScrollbackStore.prune(keepIds)`; `CardSessions.keepRunning()`; `registerScrollback()` returns `MainScrollback { store, quitSaved() }`; IPC `scrollback:quitSaved` as `window.drovr.scrollback.quitSaved()`; before-quit waits ≤1 s (`QUIT_SAVE_WAIT_MS`) for it |
| S3 | done | `0276781..0d028ca` | fixed r1 | `Preferences.keepOutput`; `ScrollbackStore.clear()`, store `keeps` option; `MainSettings.keepOutput()`/`onKeepOutputOff`; switch test id `settings-keep-output` |

## Rulings

- 2026-10-19: full auto answered round 1 with the recommendations (see the spec's decisions).
- 2026-10-19 S1: existing smoke tests expecting an empty screen after reopening → check only the lines below the newest separator (full auto, round 2).
- 2026-10-19 S1 review: a Close during the save's read gives two separators with nothing between (accepted, D2 literal); `<hash>.tmp` left by a failed save → S2's launch prune removes stray `.tmp` files too.
- 2026-10-19 S2: the quit save could not reach main before the hangups ended the shells → main waits ≤1 s for the renderer's quit saves before killAll; D2 amended (docs(spec) commit).
- 2026-10-19 S2 review: a rejected state file loads an empty board, so the launch prune removes every save (D7 as written; accepted).

## Verification

- running
