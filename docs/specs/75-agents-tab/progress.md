# Progress #75 Agent tab in the side panel

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `9ccf6a2..ce548ac` | CLEAN | IPC `agentTab:summary` → `window.bikube.agentTab.summary(folder, sessionId)`: `AgentSummaryRead` (`none`/`conversation`/`error`, src/core/agent-tab.ts); D4 checks `readAgentSummary`, `transcriptPath`, `isSessionId` in src/core/agent-transcript.ts; `agentTabSubject(workspace, card)` + `AGENT_TAB_MESSAGES` (shell branch is S2a's hook); `AgentTab.tsx` (asks once per folder/session, no polling yet), `AgentGroup`; collapsed state in src/renderer/src/agent-tab-groups.ts; test ids `agent-tab-message`, `agent-tab-error`, `agent-tab-group[data-group]`, `-toggle`, `-name`, `-count` |
| S2 | todo | | | |
| S2a | todo | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

- none yet

## Verification

- todo
- UX review: todo
