# Progress #80 Claude code session retention period

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `0655b73..7d14a7a` | fixed r1 (comment) | IPC `claudeRetention:read` → `ClaudeRetention` ({state:'low',days}/ok/unknown), `claudeRetention:set` → `SettingsWriteResult` (main frame, queued); `window.bikube.claudeRetention.read()/.set()`; core `readClaudeRetention`, `setClaudeRetention`, `CLAUDE_RETENTION_DAYS` (src/core/claude-retention.ts), `retentionNotice` (claude-retention-types.ts); renderer store src/renderer/src/claude-retention.ts: `checkClaudeRetention`, `keepClaudeConversations()` (error line or null), `dismissClaudeRetention`, `useClaudeRetention`; `writeSettingsJson` in settings-local-writer.ts |
| S2 | done | `46fac67..94edb47` | CLEAN | `AgentSetupSnapshot.claudeRetention?` (attached by main's agentSetup:read), `SetupWarning.keepConversations?`, `ConfigRow.retentionWarning?`, `retentionWarning(days)` (claude-retention-types.ts), renderer `keepConversations(folder)` in agent-setup-data.ts |
| S3 | done | `90fa4a6..7eb0b93` | CLEAN | `TranscriptBackups` (src/core/transcript-backups.ts: `backup(cardId, folder, sessionId)` → copied/unchanged/missing/refused/failed, `delete`, `prune`, `cardFolder`, `backupFolderName`); main `registerTranscripts()` (src/main/transcripts.ts) kept as `transcripts` in index.ts; IPC send `transcripts:backup`, `transcripts:delete` (`window.bikube.transcripts`); `transcriptBackupTarget(card)` → {folder, sessionId} or null (src/core/transcript-backup-target.ts); `onQuitSave(fn)` in card-terminals.ts; layout `<userData>/transcripts/<sha256>/<session>.jsonl` + `<session>/` |
| S4 | done | `7cc125e..041732f` | fixed r2 | `window.bikube.transcripts.prepare(cardId, folder, sessionId)` → present/restored/missing/refused/failed; `workspaceStore.clearClaudeStarted`; `startNewConversation(workspaceId, cardId)`; `ClaudeRetention` ok carries days, `retentionDays()` |

## Rulings

- 2026-11-11 S3: D8's folder taken as `card.directory` (where `claude` runs; a worktree card's worktree folder or inside it), not the literal worktree path, which would miss transcripts for a workspace in a repo subfolder. Spec wording clarified in its own commit; no behaviour the developer chose changes.

- 2026-11-11 S4: D12's `<n>` outside `low` read with D5's definition (the set value, or 30 when unset); `ok` carries its days.
- 2026-11-11 S4: spec's test note corrected: sync.spec AC6's local card on machine B is unchanged (claudeStarted false after sync, so D11 skips the check).

## Verification

- done (ALL PASS, e2e against the built app)
- UX review: done (2 must-fix fixed in r1, re-check CLEAN)
