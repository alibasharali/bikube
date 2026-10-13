# Progress #5 Resume and startup command

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `bbfae8f..4da41bf` | CLEAN | core startup-command.ts: `StartupCommand = {kind:'shell'}\|{kind:'claude'}\|{kind:'custom';command}`, `SHELL_STARTUP`, `StartupState {startup,agentSessionId,claudeStarted}` (Card satisfies), `checkStartup(s): Result<StartupCommand>` (field 'command': `Command is required` / `Command must be one line`), `startLine(card): string\|null` (no trailing `\r`; S2 appends). workspace-store: Card +startup/agentSessionId/claudeStarted; Workspace +defaultStartup; WorkspaceInput/Patch `defaultStartup?`; `createCard(ws,col,title,startup?)` (defaults to workspace's); `setCardStartup(ws,card,startup): Result<Card>`; `markClaudeStarted(ws,card): Result<Card>`; StoreOptions `generateSessionId?` |
| S2 | done | `8ad5a3b..5a5ae83` | fixed r1 (prettier on S1 files) | core `CardRunState = running\|stopped\|failed{reason}`; `StartingCard extends CardRef, StartupState`; `CardSessions.start(card: StartingCard, onClaudeStarted?)` (restarts stopped/failed on new screen; no-op if running; writes startLine+`\r` after spawn); `screen(id)` undefined when stopped. Renderer `startCard(wsId, cardId)` in card-actions.ts (reads current card settings; used by open and create); `useCardRunState(cardId)`; CardView returns to board on Stopped. No new testids. e2e `#5 AC3/AC6/AC10/AC11` in e2e/cards.spec.ts. Note: `npm run format` touches .github/workflows/claude-code-review.yml; run prettier on specific files only |
| S3 | done | `08c7209..e1b211d` | CLEAN | core startup-form.ts (StartupDraft helpers); StartupField.tsx, StartupDialog.tsx; testids new-card-startup/-command/-error-command, workspace-startup/-command/-error-command, card-menu-startup, startup-dialog(-startup/-command/-error-command/-save/-cancel), card-tag; e2e/startup.spec.ts (fake claude via temp HOME .bash_profile, DROVR_CLAUDE_LOG) |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

## Verification

- running
