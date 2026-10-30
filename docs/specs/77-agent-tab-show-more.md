---
item: 77
type: chore
title: Max shown items with "show more" button on Agent tab
status: draft
branch: claude/77-agent-tab-show-more
---

# Max shown items with "show more" on the Agent tab

## Problem

In the side panel's Agent tab (#75), What changed lists every file of its view and Commands its newest 200 commands, so a long session's What changed fills the whole panel and the Commands group below it is out of sight ([image 1]: 34 files of `Whole session`). Agents already folds past the latest 5 into `N finished`.

## Change

- **C1:** What changed shows its first 10 files (`SHOWN_CHANGES`) in the order it lists them (folders in order, files in each), cut by `limitChanges(shown, limit)` in `src/core/agent-changes.ts` (Node-free): folders left empty are dropped, `more` is the files left out. The heading (`<n> files · +a −r`) still totals the whole view.
- **C2:** Commands shows its newest 10 (`SHOWN_COMMANDS`, was 200).
- **C3:** Under each cut list a `Show all (<n> more)` button (`agent-changes-show-all`, `agent-commands-show-all`) shows the rest; once shown, a `Show fewer` button in its place cuts it again. What changed goes back to its first 10 when its view changes.
- **C4:** Each group's count stays the rows shown (as for Agents and Commands today).

Agents keeps its fold (the main agent, the latest 5, running rows, `N finished`).

## Acceptance criteria

- **AC1:** With 12 changed files in a view, What changed shows 10 rows, its count reads `10`, the heading `12 files …`, and `Show all (2 more)`; a click shows all 12 and `Show fewer`, which brings back 10.
- **AC2:** With 12 commands, Commands shows the newest 10 and `Show all (2 more)`; a click shows 12 and `Show fewer`.
- **AC3:** 10 or fewer rows show no button.
- **AC4:** Switching What changed's view after Show all shows the new view's first 10.

## Slices

1. **S1 – Cut lists:** `limitChanges` with Vitest in `src/core/agent-changes.test.ts`; `AgentTab.tsx`, `AgentChanges.tsx` and the CSS; `e2e/agent-tab.spec.ts` (#77 tests, and #76's 120 commands shown with Show all first). Satisfies AC1–AC4.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC3, AC4 | Vitest `limitChanges`; e2e with a fixture transcript writing 12 files | Open a Claude Code card's Agent tab with a long session |
| AC2, AC3 | e2e with 12 `Bash` uses | Same, Commands group |
