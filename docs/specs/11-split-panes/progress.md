# Progress #11 Split panes inside a card

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `d16b200..fcf8659` | fixed r1 | `split-tree` (MAIN_PANE, MAX_PANES, PaneLayout, splitFocused, removePane, focusPane, canSplit, paneIds); `SessionRouter(api)` single onData/onExit with spawn/adopt/release; `CardSessions(api, createScreen, router?)`; `CardPanes(api, router, createScreen)` layout/screen/split/focus/close/subscribe (no dispose yet); renderer `cardPanes()`, `usePaneLayout(cardId)`, `paneScreen`; test ids `pane` (data-focused), `pane-close`, `pane-split-right`, `pane-split-down`; Split down button exists, not disabled at 4 |
| S2 | done | `77c2c9f..ed21dce` | CLEAN | `splitShortcut(event, platform): SplitDirection | null` in card-shortcuts.ts; CardView capture listener handles Back + split; buttons disabled at 4 |
| S3 | done | `13ac16c..94e9698` | fixed r1 | `SessionCards` keeps every live session; `CardPanes.dispose(cardId)`; `CardSessions.onEnded(listener)` (stopped or couldn't start) wired to dispose panes; `disposeCard` in card-actions |

## Rulings

- 2026-10-14: Spec approved by full auto (no stack change).

## Verification

- done (ALL PASS; posted to the item)
- 2026-10-14 S1 (full auto): review asked whether clicking `Close pane` on an unfocused pane may move the focus to the main pane → no: D3 holds, the focus stays where it was and keyboard focus returns to that pane's terminal. The focus outline shows only while split (spec D3 clarified).
- 2026-10-14 S3 (full auto): review found extra panes survive when the main shell fails to start (D1) → option (a): end the extra panes when the main start fails too (the stop listener also fires on a failed start).
- 2026-10-14 ship review (full auto): (1) a pane change behind an open dialog must not take keyboard focus from it → skip terminal focus while an `aria-modal` dialog is open; (2) `CardPanes.split` refuses a card whose main shell isn't running (core guard, not only the view); (3) a held split shortcut (`event.repeat`) splits once; (4) add `session-router.test.ts`; (5) remounting the main pane on the first split / last close is left as is (works; keyed leaves are an optimisation) — PR trade-off.
