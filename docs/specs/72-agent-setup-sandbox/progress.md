# Progress #72 Sandbox section in Agent setup

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `d099680..5cff68b` | CLEAN | `sandboxView(snapshot, query)`, `sandboxEntries(view)` in `src/core/agent-setup-sandbox.ts`; `SandboxSection` in `AgentSetupSandbox.tsx` |

## Rulings

## Verification

- todo
- UX review: todo
