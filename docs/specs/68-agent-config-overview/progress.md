# Progress #68 Agent setup

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 – The page and its navigation | done | `8c5526e..abaaddc` | CLEAN | View memory `{kind:'card',cardId}\|{kind:'agentSetup'}` (`rememberAgentSetup`, `showsAgentSetup`, `agentSetupWorkspaces`); palette action `{id:'agentSetup'}`; sections in `src/core/agent-setup-sections.ts`; section views in `SECTION_VIEWS` (`AgentSetupPage.tsx`) with `AgentSetupSectionProps {workspace, query, onShowSection}`; `SectionList` takes `counts`, `warnings`; Refresh `agent-setup-refresh` has no handler; `useAgentSetupMemory` (section, query per workspace) |
| S2 – Reading the sources | done | `e2a126b..717e2ee` | fixed r1 | `AgentSetupSnapshot` in `src/core/agent-setup-snapshot.ts` (settings local-first, claudeJson, mcpJson, installedPlugins, marketplaces, plugins with enabled/hooks/mcpServers, memory, more, fileWarnings, `paths`); `readAgentSetup({folder, home, fs?})` in `src/core/agent-setup-reader.ts`; IPC `agentSetup:read` / `window.bikube.agentSetup.read(folder)` in `src/main/agent-setup.ts`; `agentSetupListed(folder, path)` for S6; rows/warnings in `src/core/agent-setup-rows.ts` (`sectionSummaries`, `setupWarnings`); section views in `AgentSetupSections.tsx` get `{workspace, snapshot, query, onShowSection, expanded}`; `FileActions` slot renders nothing; refresh in `src/renderer/src/agent-setup-data.ts` |
| S3 – Hooks, Permissions, Status | done | `88c7ec3..4f81b66` | fixed r1 | `HookEntry` (`file` absent for Bikube's), `snapshot.hooks`, `snapshot.bikubeSettings`; `readAgentSetup({…, bikubeSettings?})` (never in `paths`); rows: `HOOK_EVENT_ORDER`, `hookGroups`, `effectiveSetting(settings, key)`, `permissionsView`, `permissionRules`, `accountText`, `settingsFileStates`; `claudeSettingsPath()` in `src/main/board.ts`; `registerAgentSetup(shellSetting)`; IPC `agentSetup:claudeVersion`; `useClaudeVersion`; `runLoginShell(plan, deps)` in installed-agents.ts; `FileActions` on hook, permission and Status file rows (not Bikube's, not missing files) |
| S4 – Plugins and MCP servers with switches | running | | | |
| S5 – Config and in-place edits | todo | | | |
| S6 – Open file and Reveal | todo | | | |
| S7 – Stats | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-27 S2 (orchestrator, following the spec as written): an ancestor folder's `CLAUDE.local.md` is `Project` per D17; the workspace folder's own stays `Local`.

## Verification

- todo
- UX review: todo
