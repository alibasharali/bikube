# Progress #25 `board` command inside SSH cards

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `3fb141f..8102d29` | CLEAN | `sshShellLine(host, dir, board?: { cardId, remoteSocket, localSocket: string \| null })`; `remoteCommand(dir, board?)`; `remote-board.ts`: `CANT_REACH`, `NEEDS_PERL_OR_PYTHON`, `perlClient()`, `pythonClient()`, `remoteBoardScript()`, `shellQuote()`. Remote socket must match `^/[A-Za-z0-9._/-]+$`; local socket with `:` → no `-R`. |
| S2 | done | `3778837..d5543b1` | CLEAN | `SessionSockets` (core), `removeLeftoverSessionSockets`, `registerBoard(socketPath, terminals, ssh)` |

## Rulings

- 2026-10-14: spec approved by full auto (round 1 answered with the recommendations).

- 2026-10-14 S2: a failed remote `cd` leaves the forwarded socket in `/tmp` (D4 cleans up on exit/HUP/TERM only) → accepted as is, keeps AC8's `cd <dir> || exit 255; ` prefix.
- 2026-10-14 S2: #12's ssh log patterns now admit the leading `-R …` (AC10 wording updated).

## Verification

- todo
