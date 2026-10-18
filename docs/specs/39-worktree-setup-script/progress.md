# Progress #39 Setup script for new worktree cards

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `bf65b6e..55c6a1b` | CLEAN | `Workspace.worktreeSetup: string` ('' none; optional on WorkspaceInput/WorkspacePatch); `checkWorktreeSetup(raw): Result<string>` (field 'setup'); test ids `workspace-worktree-setup`, `workspace-error-setup`; e2e/worktree-setup.spec.ts |
| S2 | done | `7a9d67f..953efbf` | CLEAN | `Card.setup?: string`; `store.clearCardSetup(wsId, cardId)`; `setupLine(setup)` (startup-command.ts); CardSessions: `SetupState = 'running'\|'failed'`, `setupState(id)`, `typeSetup(id, setup)` (retry), `setupFailed(id)`, `continueAfterSetup(card, onFirstStart)`, `onSetup(listener)`; card-actions `continueAfterSetup(workspaceId, card)` (Skip: clear store first); CardStatus has no setup field yet |
| S3 | done | `d42f36a..7a8918c` | fixed r1 (wrapped rows in e2e, stale Skip) | `CardStatus.setup?`, `cardPill(status)`; card-actions `retrySetup`, `skipSetup`; test ids `card-setup-pill`, `card-menu-retry-setup`, `card-menu-skip-setup` |

## Rulings

- 2026-10-18 S3: the open card has no menu since #31 → Retry/Skip only in the board card's menu; D6 amended.
- 2026-10-18 S2 review: a setup ending in `;`, `&` or `|` would never report back (card stuck Setting up) → D1/AC2 amended to refuse it (full auto); built in S3.
- 2026-10-18: grilling round 1 answered by full auto with the recommendations (see spec D1–D10).

## Verification

- done (ALL PASS, e2e on the running app at 1 worker; AC12 card part by Vitest)
