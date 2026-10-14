# Progress #18 Make sure no shells survive app quit (SIGKILL escalation, e2e check)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `19c68c2..1722e46` | fixed r1 | `KILL_GRACE_MS`; `SessionManager.killAll(): Promise<void>`, `forceKillAll()`; `Terminals.sessionCount`, `killAll(): Promise<void>`, `forceKillAll()` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

## Verification

- done (ALL PASS, 2026-10-14)
