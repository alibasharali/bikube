# Progress #21 Resume presets for other agents (Codex etc.)

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `6e11d2f..5ab138e` | CLEAN | `AgentKind`, `AGENT_PRESETS`, `isAgentKind` (core/agent-presets); `Card.startedAgents`; store `markAgentStarted`; `firstStart(card)`, `CardSessions.start(card, onFirstStart(kind))` fires in `sessionStarted` (after the SSH marker); `toSyncBoard` passes `startedAgents` through (S2: D7 mapping in sync-file + sync-apply); e2e `fakeAgentsHome`, `addFakeAgents(home, log)`, `agentLogLines` |
| S2 | done | `f999003..620e9a8` | fixed r1 (comment widths) | none new |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- None yet.

## Verification

- todo
