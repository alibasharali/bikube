# Progress #80 Claude code session retention period

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `0655b73..7d14a7a` | fixed r1 (comment) | IPC `claudeRetention:read` → `ClaudeRetention` ({state:'low',days}/ok/unknown), `claudeRetention:set` → `SettingsWriteResult` (main frame, queued); `window.bikube.claudeRetention.read()/.set()`; core `readClaudeRetention`, `setClaudeRetention`, `CLAUDE_RETENTION_DAYS` (src/core/claude-retention.ts), `retentionNotice` (claude-retention-types.ts); renderer store src/renderer/src/claude-retention.ts: `checkClaudeRetention`, `keepClaudeConversations()` (error line or null), `dismissClaudeRetention`, `useClaudeRetention`; `writeSettingsJson` in settings-local-writer.ts |
| S2 | running | | | |
| S3 | todo | | | |
| S4 | todo | | | |

## Rulings

## Verification

- todo
- UX review: todo
