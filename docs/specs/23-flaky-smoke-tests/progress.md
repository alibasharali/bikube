# Progress #23 Flaky smoke tests: window launch timeout and fake-claude buffer poll

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `71e7147..HEAD` | fixed r1 (retry fits the test timeout, `onStderr` only for the kept launch, timeout override validated, AGENTS.md, lint `cause`) | `launchApp` retries once; `DROVR_E2E_WINDOW_TIMEOUT_MS` |

## Rulings

None (full auto).

## Verification

- done: AC1 and AC2 each 20 passes in a row (AC9 and AC5), retry path checked with DROVR_E2E_WINDOW_TIMEOUT_MS=1 (logs the reason and stderr, fails with both), check.sh green, smoke 174 passed
