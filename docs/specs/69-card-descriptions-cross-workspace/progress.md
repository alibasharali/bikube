# Progress #69 More detailed cards and Cross-Workspace collab

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Description field, dialogs and icon | done | `c6a1f6e..5cf2098` | fixed r2 | `src/core/card-description.ts`: `MAX_DESCRIPTION_LENGTH`, `DESCRIPTION_COUNTER_FROM`, `descriptionLength`, `normalizeDescription`, `checkDescription` (field `'description'`), `isDescription`, `descriptionTooltip`; `src/core/dialog-keys.ts`; `Card.description?`; store `createCard(…, worktree?, description?)`, `setCardDescription(ws, card, text)`; renderer `DescriptionField.tsx`, `DescriptionDialog.tsx`; card-view action `editDescription` (palette row); e2e ids `new-card-dialog`, `new-card-description`, `new-card-create`, `card-menu-description`, `description-dialog(-input/-save/-cancel)`, `card-description`; old `new-card-*` ids kept; terminals take no keys while an `aria-modal` dialog is open (card-terminals.ts) |
| S2 `board description`/`describe` and the first prompt | done | `224b76d..916bed0` | CLEAN | `startLine` reads `StartupState.description?`; `FIRST_PROMPT`, `AgentPreset.promptFlag`; `BoardCommand` `description`/`describe` (new commands: `FIELDS` + `parseRequestLine` in board-protocol, `commandOf` in board-relay, `answerBoardCommand`); `BoardArgs` `descriptionFile`; `MAX_REQUEST_LINE_BYTES` 512 KiB, `MAX_REPLY_ERROR_LENGTH` 8192; `readDescriptionFile(path, readStdin?)` in `src/core/description-file.ts` (for `--description-file`); `runBoard(…, readStdin)`; `SSH_CLAUDE_INSTRUCTION`, `LOCAL_CLAUDE_INSTRUCTION` (already names workspaces/create --workspace); `servesOwnCard` in session-sockets.ts |
| S3 `board` across workspaces | todo | | | |
| S4 Worktree on first open | todo | | | |
| S5 Sort and dates | todo | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-27 S1 (orchestrator call, not a developer ruling): D4's "the open card's menu" doesn't exist since #31 → an `Edit description…` palette row for the open card; spec corrected in 5410118. Flag in the PR.

## Verification

- todo
- UX review: todo
