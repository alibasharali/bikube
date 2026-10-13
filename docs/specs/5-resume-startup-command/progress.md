# Progress #5 Resume and startup command

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `bbfae8f..4da41bf` | CLEAN | core startup-command.ts: `StartupCommand = {kind:'shell'}\|{kind:'claude'}\|{kind:'custom';command}`, `SHELL_STARTUP`, `StartupState {startup,agentSessionId,claudeStarted}` (Card satisfies), `checkStartup(s): Result<StartupCommand>` (field 'command': `Command is required` / `Command must be one line`), `startLine(card): string\|null` (no trailing `\r`; S2 appends). workspace-store: Card +startup/agentSessionId/claudeStarted; Workspace +defaultStartup; WorkspaceInput/Patch `defaultStartup?`; `createCard(ws,col,title,startup?)` (defaults to workspace's); `setCardStartup(ws,card,startup): Result<Card>`; `markClaudeStarted(ws,card): Result<Card>`; StoreOptions `generateSessionId?` |
| S2 | running | | | |
| S3 | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

## Verification

- todo
