# Progress #52 Inline images in terminals

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | ef3e69b, 33f7677 | CLEAN | `TerminalHost.__images` (ImageAddon), `IMAGE_OPTIONS` = { storageLimit: 32, enableSizeReports: true } |
| S2 | done | a95001c | CLEAN | `Preferences.inlineImages`, Settings testid `settings-inline-images` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-19: the renderer CSP may add `'wasm-unsafe-eval'` to script-src (round 2, answered on the board), so the image addon's WebAssembly decoders run; JS eval and remote scripts stay blocked.

## Verification

- todo
