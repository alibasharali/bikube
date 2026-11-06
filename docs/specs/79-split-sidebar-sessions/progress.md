# Progress #79 Split Workspaces and Agents/sessions option

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b515dd8..077deef` | CLEAN | `src/core/sidebar-sections.ts`: `isAgentRow(row, claudeRunning=false)` (S2 passes rule 2), `agentGroupOf`, `sidebarSections(terminals, isAgent, activeId)` → `{nested, agents, numbers}`; Sidebar.tsx passes `(row) => isAgentRow(row)` in Split (S2 changes it); `TerminalRow` exported with optional `workspaceName` (S3: time in that branch before `StatusMark`); S4: collapsed icons in Sidebar.tsx at the `split && !collapsed` check; test ids `sidebar-agents`, `sidebar-agents-empty`, `agent-group[data-group]`, `agent-group-heading`, `agent-row-workspace`, `settings-sidebar-nested/split`; `SidebarAgents.tsx`; e2e `e2e/sidebar-split.spec.ts` |
| S2 | todo | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

- none

## Verification

- todo
- UX review: todo
