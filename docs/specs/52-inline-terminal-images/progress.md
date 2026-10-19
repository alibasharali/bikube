# Progress #52 Inline images in terminals

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | blocked | | | Needs the developer: the addon decodes with WebAssembly, so the renderer CSP needs `'wasm-unsafe-eval'` in script-src (src/renderer/index.html); without it no image decodes and e2e/inline-images.spec.ts fails. `TerminalHost.__images` (ImageAddon), `IMAGE_OPTIONS` = { storageLimit: 32, enableSizeReports: true } |
| S2 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- None.

## Verification

- todo
