# Progress #79 Split Workspaces and Agents/sessions option

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b515dd8..077deef` | CLEAN | `src/core/sidebar-sections.ts`: `isAgentRow(row, claudeRunning=false)` (S2 passes rule 2), `agentGroupOf`, `sidebarSections(terminals, isAgent, activeId)` → `{nested, agents, numbers}`; Sidebar.tsx passes `(row) => isAgentRow(row)` in Split (S2 changes it); `TerminalRow` exported with optional `workspaceName` (S3: time in that branch before `StatusMark`); S4: collapsed icons in Sidebar.tsx at the `split && !collapsed` check; test ids `sidebar-agents`, `sidebar-agents-empty`, `agent-group[data-group]`, `agent-group-heading`, `agent-row-workspace`, `settings-sidebar-nested/split`; `SidebarAgents.tsx`; e2e `e2e/sidebar-split.spec.ts` |
| S2 | done | `ea5ea31..2187a41` | CLEAN | `ClaudeCodeTerminals` in `src/core/claude-code-terminals.ts`; `XtermScreen.claudeCodeInPane()`/`onClaudeCodeChange`; `useClaudeCodeTerminals(): ReadonlySet<string>` in `card-terminals.ts`; Sidebar Split passes `isAgentRow(row, claudeCode.has(row.cardId))` |
| S3 | done | `2d39c2e..058c91a` | CLEAN | `formatAge`, `GroupStamps` in `src/core/status-time.ts`; `useGroupStamps(rows)`, `useRedrawClock()` in `src/renderer/src/status-times.ts`; `TerminalRow` `since?`, `agent-row-time`, `.workspace-terminal-time`; `SidebarAgents` takes `stamps`; Sidebar keeps stamps for every running row (S4 icons can read them) |
| S4 | done | `405c0d6..7f94a5b` | CLEAN | `SidebarAgentIcons` (`sidebar-agent-icons`, `agent-icon`); `statusLabel` in `src/core/activity.ts` |

## Rulings

- none

## Verification

- done (ALL PASS)
- UX review: done (1 must-fix fixed in r1: current agent row contrast)
