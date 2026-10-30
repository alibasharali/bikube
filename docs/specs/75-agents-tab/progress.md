# Progress #75 Agent tab in the side panel

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `9ccf6a2..ce548ac` | CLEAN | IPC `agentTab:summary` → `window.bikube.agentTab.summary(folder, sessionId)`: `AgentSummaryRead` (`none`/`conversation`/`error`, src/core/agent-tab.ts); D4 checks `readAgentSummary`, `transcriptPath`, `isSessionId` in src/core/agent-transcript.ts; `agentTabSubject(workspace, card)` + `AGENT_TAB_MESSAGES` (shell branch is S2a's hook); `AgentTab.tsx` (asks once per folder/session, no polling yet), `AgentGroup`; collapsed state in src/renderer/src/agent-tab-groups.ts; test ids `agent-tab-message`, `agent-tab-error`, `agent-tab-group[data-group]`, `-toggle`, `-name`, `-count` |
| S2 | done | `e1caaaf..f43a669` | CLEAN | `agentTab.summary(folder, sessionId, since?)` → `none`/`conversation{version, summary}`/`unchanged`/`error{reason}`; `AgentSummary {model, todos, commands}`, `AgentCommand {id, description, command, status, exitCode, startedAt, endedAt, output, agent}` (src/core/agent-summary.ts); parser `TranscriptState` + `addTranscriptLine(state, line, agent)` (agent null for main, subagent name for S3; sidechain entries in the main file skipped), caps `SUMMARY_LIMITS`; main `TranscriptTailer` (src/core/agent-transcript.ts) tails only the main file (S3 feeds subagent files into the same state); dev hook `__bikubeAgentTabRequests`; `ContextBar` exported from CardLines.tsx; `commandSteps` (command-layout.ts), `formatDuration`, `clockTime` (agent-format.ts) |
| S2a | done | `7b74d13..HEAD` (fc10021 + 2 review fixes) | fixed r2 (import order; an added lookup cache dropped as it broke D3a's newest-file rule) | shells: `shell-agents.ts` (`shellAgent`, `useShellAgent`, `setShellSession`, `setShellUsage`, `clearShellAgent`, `subscribeShellAgents`); `answerBoardCommand` 10th param `setShellSession`; `agentTabSubject(workspace, card, shell?)` (subject `shell: true`, folder = shell card's directory); IPC `agentTab.sessionSummary(sessionId, since?)` via `readSessionSummary`/`findSessionTranscript(home, id, fs?)` returning the main file path (subagents/ beside it); `agentRows(activity)` + `AgentRow{kind:'main'}` + `AGENT_ROW_STATUS_LABELS` (src/core/agent-rows.ts), `AgentList` (test ids `agent-row`, `-name`, `-status`); `AgentView` takes `usage`, `activity` |
| S3 | done | `13ab073..33c6221` | CLEAN | `AgentSummary.agents?: AgentTask[]` (omitted when empty) `{id, kind: subagent/background, name, description, status, startedAt, endedAt, toolUses}`; `addSubagentLine(state, file, line)` reaches the same `addLine` as the main file (S4: subagents' file changes come through it); `SUMMARY_LIMITS.agents`, `.agentName`; `subagentsFolder(path)`, `TailFs.readdir?`; `agentRows(activity, agents?, shellRunning?)`, `agentDuration`, `foldAgentRows`, `SHOWN_AGENT_ROWS`; test ids `agent-row-description`, `-duration`, `-tools`, `agent-rows-finished`; `AgentView` takes `running` |
| S4 | done | `0c59b94..87c4ab6` | CLEAN | `AgentSummary.prompts?`, `.changes?`; `changesView`, `viewOptions` (agent-changes.ts); `commandFileChanges`, `diffCount`, `patchCount` (agent-file-changes.ts); `AgentChanges.tsx` |

## Rulings

- 2026-10-29 S2a (orchestrator): a lookup cache added in review was dropped because it broke D3a's newest-file rule; the shell lookup scans the projects folder per request, as specced.
- 2026-10-29 S4 (orchestrator): the parser also keeps at most the newest 1,000 prompts in the picker (in D11's spirit; their file changes still count under Whole session). Listed in the PR's trade-offs.
- 2026-10-30 polish (developer, PR #95): What changed drops the prompt's summary (the main agent's last reply), and the parser stops keeping it; the view select and the count share a line. Agents and Commands rows lose their chips for a coloured icon and word, Commands rows are two lines (the command only under a description, the time moved beside Copy), and an expanded command's operators sit in a gutter. D8, D9, D10, AC10 and AC11 revised to match.

## Verification

- done: ALL PASS (verifier, e2e/agent-tab.spec.ts 14/14 + Vitest)
- UX review: done (2 must-fix fixed in 8fafc06: chip/accent contrast, 4 px stacked gaps; re-check CLEAN)
