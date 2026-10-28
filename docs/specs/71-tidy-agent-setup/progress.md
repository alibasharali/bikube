# Progress #71 Tidier Agent setup page

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `4f8e55e..8689fb4` | CLEAN | `SourceFilter`, `matchesSource`, `filterLabel`, `noMatchText`, `sourceChips(snapshot, section, query, filter)`, `FILTERABLE_SECTIONS` in agent-setup-rows.ts; row fns and `sectionSummaries` take optional `filter`; `useAgentSetupMemory` returns `filter`/`setFilter`; chip row `AgentSetupFilter.tsx` rendered in `LocalAgentSetup` for filterable sections (Overview not yet); `MenuButton` `pressed` prop |
| S2 | done | `3b1441a..b058b74` | CLEAN | `SplitPart`, `sourceSplitParts`, `OVERVIEW_SECTIONS`, `ChipSection`, `showsSourceChips` in agent-setup-rows.ts; `sourceChips` takes `'overview'`; section props have `onFilter` (no `onSearch`); `pluginQuery` removed; S3's collapsed groups go into `PageMemory` via `update` |
| S3 | done | `acfe5be..8dc87e0` | CLEAN | `collapsedGroupKey`, `toggleCollapsedGroup` in agent-setup-sections.ts; `PageMemory.collapsed`, `toggleGroup`; `CollapsibleGroup` in AgentSetupSections.tsx |

## Rulings

## Verification

- todo
- UX review: todo
