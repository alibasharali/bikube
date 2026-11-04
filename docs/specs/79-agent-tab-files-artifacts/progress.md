# Progress #79 Files and artifacts in the Agent tab

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 – Parsing | done | `82e7765..919d574` | fixed r1 (+2 rulings) | `src/core/agent-outputs.ts`: `OUTPUT_EXTENSIONS`, `outputPath(path)`, `outputPaths(text)`, `artifactUrls(text)`. `agent-summary.ts`: `SUMMARY_LIMITS.outputs = 200`; `AgentSummary.outputs?: AgentOutput[]` oldest first; `AgentOutput = {kind:'file', path, at: number\|null} \| {kind:'artifact', url, title?, type?: 'doc'\|'page', at}`; file paths absolute or `~/`-prefixed |
| S2 – Main | running | | | |
| S3 – The group | todo | | | |

## Rulings

- 2026-11-04: the factory MCP server is down (invalid url), so there is no board item yet; 79 is provisional. Claude may branch and commit in this project.

- 2026-11-04 S1: artifact links from any tool result, or from single-artifact results only? → single-artifact results and the reply text (D4 amended).
- 2026-11-04 S1: store `$HOME/` as `~/`? → yes (D6 amended).

## Verification

- todo
- UX review: todo
