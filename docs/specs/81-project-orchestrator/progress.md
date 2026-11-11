# Progress #81 Project orchestrator

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Remove the Default shell | done | `a44df3b..4bc34f2` | CLEAN | `newShell(workspaceId)` (temporary-shells.ts) adds+returns a temporary shell id; `shellCard(ws, shell)` needs a WorkspaceShell; `findShellCard` covers named+temporary only; e2e `openTerminal(page)`/`NEW_SHELL` in e2e/card-view.ts; sidebar `workspace-terminal-status` shows a shell's `board status` |
| S2 The Orchestrator terminal | done | `60cc14d..0a5c65d` | fixed r1 (D7: running keeps its agent) | src/core/orchestrator.ts: `orchestratorId`, `isOrchestratorId`, `orchestratorWorkspaceId`, `orchestratorCard(ws, startup)` (undefined for SSH), `findOrchestratorCard`, `findTerminalCard`, `currentOrchestratorStartup`; renderer `findTerminal(ws,id)`, `orchestratorStartupOf(id)`, orchestrator-starts.ts map; `callingTerminal` kind 'orchestrator', board-answer `answerOrchestrator` (S3 refuses its id on board.sock there); env `boardShellEnv` (src/core/board-env.ts) sets BIKUBE_ORCHESTRATOR=1, spawn via `boardShellEnvFor` → src/main/terminals.ts (S3 swaps socket); `Card.firstPrompt` + `ORCHESTRATOR_FIRST_PROMPT` in startLine; store `ensureOrchestrator`, `newOrchestratorConversation`; Settings.orchestratorStartup; actions `openOrchestrator`, palette `orchestratorNewConversation`; board create from orchestrator already uses target workspace's default agent |
| S3 Orchestrator socket and instructions | todo | | | |
| S4 Start, open, terminal and orchestrated cards | todo | | | |
| S5 Send, wait and reply | todo | | | |
| S6 Palette from `board` | todo | | | |

## Rulings

- 2026-11-11: spec approved in the factory (blob 99bf755).

## Verification

- todo
- UX review: todo
