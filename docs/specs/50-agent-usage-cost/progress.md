# Progress #50 Agent usage and cost per card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `7131203..c7459d4` | CLEAN | `ClaudeUsage` (claude-pricing.ts), `readClaudeUsage(path)` (claude-usage.ts, rejects when unreadable), `usageLine`, `usageTooltip`, `workspaceUsage`, `hasUsage` (usage-format.ts) |
| S2 | running | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

- 2026-10-19: spec approved by full auto (round 1 answered with the recommendations).

- 2026-10-19 S1 review: invalid counts or an over-long model from a transcript would fail main's check → the reader treats such counts as 0 and cuts the model to 200 characters (spec D2 clarified).

## Verification

- todo
