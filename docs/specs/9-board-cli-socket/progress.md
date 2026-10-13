# Progress #9 board CLI over a local socket

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `b5546a7..70492ce` | CLEAN | `src/core/board-args.ts`: `BOARD_USAGE`, `BoardCommand`, `BoardArgs`, `parseBoardArgs(argv)`; `src/core/board-protocol.ts`: `BOARD_PROTOCOL_VERSION`, `MAX_REQUEST_LINE_BYTES`, `INVALID_REQUEST`, `REQUEST_TOO_LONG`, `BoardRequest`, `BoardReply`, `serializeRequest(cardId, command)`, `parseRequestLine(line)`, `isOverLineLimit(line)`, `serializeReply(reply)`, `parseReplyLine(line)`; `src/core/board-commands.ts`: `BoardResult<T>`, `NOT_IN_A_CARD`, `CALLING_CARD`, `MAX_AGENT_STATUS_LENGTH`, `findCallingWorkspace(state, id)`, `resolveCard(ws, callingId, ref)` (call after findCallingWorkspace), `resolveColumn(ws, ref)`, `boardMoveTarget(ws, card, columnId)` (null = same column no-op), `cleanAgentStatus(text)`, `notRunningError(card)` |
| S2 | done | `b33286f..629c0bd` | CLEAN | `terminal.spawn(cols, rows, cwd, cardId)`; `window.drovr.board.onRequest((cardId, command) => BoardReply)` (IPC `board:request`/`board:answer`); `answerBoardCommand(store, callingCardId, command, isRunning)` in core/board-answer.ts (status: resolves + running check only, S3 sets/shows text); `SessionManager.spawn({..., env})`; shell env `DROVR_CARD_ID`, `DROVR_SOCKET`, `DROVR_EXECUTABLE`, `DROVR_BOARD_CLI`, bin dir first on PATH; renderer `board-requests.ts`; packaging: `asarUnpack` out/main/board-cli.js + chunks, `extraResources` bin → resources/bin |
| S3 | done | `d4fc460..5e0a406` | CLEAN | `cardStatus(state, lastLine, agentStatus = '')`; `CardSessions.setAgentStatus(cardId, text): boolean` (cleared in `setState`); `answerBoardCommand(store, callingCardId, command, isRunning, setAgentStatus)` |
| S4 | done | `577a593..`HEAD | fixed r1 (docs wording) | `answerBoardCommand(..., setAgentStatus)` required; AC11 confirmed in unpacked app (`electron-builder --dir -c.npmRebuild=false`) |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- None yet.

## Verification

- done (ALL PASS)
