# Progress #67 New terminals should not show up in “shells” pane

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | see branch | 3 test gaps fixed (`fix(review)`) | `listedShellCards` in core/workspace-shells |

## Rulings

None.

## Verification

- done (ALL PASS: AC1, AC2 by `e2e/shells.spec.ts` against the built app under xvfb)
- UX review: skipped: the change only removes rows from an existing list; no new layout or styles
