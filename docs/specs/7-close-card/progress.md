# Progress #7 Close card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `cd0c8c1..b81f170` | CLEAN | `CardSessions.close(cardId)` (kills a running card's session; no-op otherwise; closing while starting kills on spawn), `cardCloseConfirmation(title)` in core/card-deletes |
| S2 | done | `76498e0..6551b20` | fixed r1 | `closeCard(cardId)`, `ConfirmDialog` `confirmTestId?`, test ids `card-menu-close`, `card-close`, `confirm-close`; e2e/fake-claude.ts shared helper |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-13 S2: two exact menu lists in e2e/moves.spec.ts gain `Close` (orchestrator, from spec D3, which adds it to a running card's menu).
- 2026-10-13: Idea promoted to feature by full auto; grilling round 1 answered by full auto with the recommendations; spec approved by full auto (no stack change).

## Verification

- done: ALL PASS (AC1–AC7), 2026-10-13

## Ship review

- Fresh-context review: the full-size Close dialog could outlive a failed start (guard added in CardView), the board guard from 6551b20 had no test (e2e added), close-while-starting wasn't in the spec (D2 clarified). check.sh green, smoke 65 passed.
- Retro: no new lessons. The blocked Electron headers in `npm ci` are already covered by `docs/agents/stack.md` (read it first next time); `react-hooks/set-state-in-effect` is enforced by lint.
