# Progress #81 Project orchestrator

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 Remove the Default shell | done | `a44df3b..4bc34f2` | CLEAN | `newShell(workspaceId)` (temporary-shells.ts) adds+returns a temporary shell id; `shellCard(ws, shell)` needs a WorkspaceShell; `findShellCard` covers named+temporary only; e2e `openTerminal(page)`/`NEW_SHELL` in e2e/card-view.ts; sidebar `workspace-terminal-status` shows a shell's `board status` |
| S2 The Orchestrator terminal | done | `60cc14d..0a5c65d` | fixed r1 (D7: running keeps its agent) | src/core/orchestrator.ts: `orchestratorId`, `isOrchestratorId`, `orchestratorWorkspaceId`, `orchestratorCard(ws, startup)` (undefined for SSH), `findOrchestratorCard`, `findTerminalCard`, `currentOrchestratorStartup`; renderer `findTerminal(ws,id)`, `orchestratorStartupOf(id)`, orchestrator-starts.ts map; `callingTerminal` kind 'orchestrator', board-answer `answerOrchestrator` (S3 refuses its id on board.sock there); env `boardShellEnv` (src/core/board-env.ts) sets BIKUBE_ORCHESTRATOR=1, spawn via `boardShellEnvFor` → src/main/terminals.ts (S3 swaps socket); `Card.firstPrompt` + `ORCHESTRATOR_FIRST_PROMPT` in startLine; store `ensureOrchestrator`, `newOrchestratorConversation`; Settings.orchestratorStartup; actions `openOrchestrator`, palette `orchestratorNewConversation`; board create from orchestrator already uses target workspace's default agent |
| S3 Orchestrator socket and instructions | done | `ef526c3..9a2350d` | fixed r1 (instructions saved as typed) | board-args.ts: `BoardCommand` has all D17–D23 shapes, `parseOrchestratorCommand` (terminal's command in `line`), `ORCHESTRATOR_ONLY_COMMANDS`, `isWaitTimeout`, `WAIT_*_SECONDS`; board-protocol FIELDS/asRequest + relay `commandOf` already carry them; main `sharedSocketHandler` (session-sockets.ts) refuses them on board.sock; renderer answers in `answerOrchestratorOnly` (board-answer.ts) with `OrchestratorAnswers` hooks passed from board-requests.ts (unbuilt reply `board: <name> is not available yet`); CLI reply timeout = `timeoutMs` of `runBoard`/`sendBoardRequest` (5 s), relay `RELAY_TIMEOUT_MS` 4 s (BoardRelay ctor) — S5 lengthens both for wait; send stdin + 100k cap left to S5; guide constant src/core/orchestrator-guide.ts |
| S4 Start, open, terminal and orchestrated cards | done | `5a98482..d933214` | HUMAN item carried to S5 as a D17 fix (slow start answered as success at 3 s) | `answerBoardRequest` (board-answer.ts) → `answerAwaited` for start/open/terminal (Promise), add `wait` to `AwaitedCommand`/`isAwaited`; `OrchestratorAnswers.start/open`; `startForBoard(ws,id)` (renderer board-starts.ts, `START_WAIT_MS` 3 s, polls `startOutcome` in src/core/board-start.ts); `openForBoard` → App `onBoardOpen`; store `createTemporaryShell(ws, command?)`; `ORCHESTRATED_FIRST_PROMPT`; failed start `board: "<title>" couldn't start: <reason>` |
| S5 Send, wait and reply | done | `81a03c5..7883dbb` | fixed r1 (stdin trailing newlines trimmed) | per-command timeouts `answerTimeoutMs`/`relayTimeoutMs` (board-protocol.ts; default 5 s CLI / 4 s relay); awaited commands via `AWAITED`/`answerAwaited` (board-answer.ts), palette still `not available yet`; `OrchestratorAnswers.send/wait/reply`; IPC `agentTab:reply`; `StartOutcome.pending` (start waits 60 s, relay 64, CLI 65) |
| S6 Palette from `board` | done | `e396704..15472ec` | fixed r1 (tsbuildinfo un-tracked) | `orchestratorPaletteRows`, `findPaletteRow` (palette.ts); renderer palette-input.ts, board-palette.ts |

## Rulings

- 2026-11-11: spec approved in the factory (blob 99bf755).
- 2026-11-11 S4 (orchestrator, from D17): a start still pending past the relay limit must not read as success → S5 makes timeouts per command (start/open/terminal ~60 s) and prints `<title> is still starting` if still undecided. e2e uses `Backlog` (AC9) and `echo ready` (AC11) as test setup only.
- 2026-11-11 S5 (orchestrator, following #69 D5's stdin trim): `board send <card> -` trims stdin's trailing new lines; an argument's text is sent as given.

## Verification

- done: ALL PASS (AC1, AC3, AC8, AC11, AC12, AC14 observed directly; the rest via e2e)
- UX review: 2 must-fix (round 1)
