---
item: 42
type: feature
title: Move cards automatically on activity
status: draft
branch: claude/42-auto-move-cards
---

# Move cards automatically on activity

## Problem

A card's column is meant to say where its work stands, but today a card only moves when the user drags it or an agent is told to call `board move`. Claude Code cards already report their activity (`board activity`, set by Drovr's hooks: working on a prompt, waiting after a turn, a question on a permission prompt), and every card reports when its shell stops. After this ships, a workspace can have up to three rules, set in its Edit dialog: move a card to a chosen column when it starts working, when it waits for the user or needs an answer, and when its shell stops. They are off by default, saved, and synced with the workspace.

## Domain decisions

- **D1 – Three triggers:** a workspace has three optional rules, each naming one of its columns: **Working** (the card's activity becomes `working`), **Waiting** (its activity becomes `waiting` or `question`: one rule for both, since both mean the user is needed) and **Stopped** (D4). A rule with no column is off. *Why:* the item's three cases; waiting and question land in the same "needs me" column in practice, so separate rules would add a select nobody sets differently. Rejected: four rules, two rules without Stopped.
- **D2 – Stored by column id:** the rules live on the workspace as an optional `autoMove` object: `{ working?: <columnId>, waiting?: <columnId>, stopped?: <columnId> }`; a key is present only for a rule that is on, and the workspace has no `autoMove` key at all when every rule is off (as `logo` in #59 D2). Renaming a column keeps its rules. Deleting a column turns off every rule naming it (the store removes them in the same change). *Why:* ids survive renames, unlike names.
- **D3 – When a rule fires:** only on a change. When a card's activity changes to `working`, or to `waiting` or `question` from anything else (including from the other of those two, which moves nothing new since the target is the same), and its workspace's matching rule is on, the card moves to the bottom of that column exactly as `board move` does (`boardMoveTarget`, `moveCard`: saved and synced like any move). A card already in that column doesn't move. Clearing the activity (`none`, or the clear on stop and start) fires nothing. A card the user dragged elsewhere stays there until the next change. *Why:* mirrors `board move`; the user keeps control between changes. Rejected: continuously keeping cards in the rule's column.
- **D4 – What counts as Stopped:** the card's shell exits by itself or is Closed (#7) while the app runs, and the card turns `Stopped`. Not a start that failed (`Couldn't start`), not an SSH card whose connection failed (`SSH failed`), not a delete, not the app quitting, and not launch: cards restored as Stopped after a restart stay where they were. Extra panes ending (#11) are not the card stopping. *Why:* a restart must not reshuffle the board, and a failed start or connection is not finished work.
- **D5 – Every card, every workspace:** rules apply to every card of the workspace (any startup command, worktree cards, SSH cards, whether or not the workspace is the one shown), from activity set in its main pane or any extra pane. They never apply to a workspace's shells, which aren't on the board.
- **D6 – Set in the Edit workspace dialog only:** the Edit workspace dialog gets a **Move cards automatically** fieldset below Worktree setup (shown for local and SSH workspaces alike), with three labelled selects: **When working**, **When waiting for you** and **When stopped**. Each lists **Don't move** first, then the board's columns in board order, and shows the saved rule (Don't move for an off rule). Nothing changes until Save; Cancel keeps the rules. The Create workspace dialog has no such fieldset: a new workspace starts with every rule off. *Why:* the rules name columns, which are the board's own; one place to set them.
- **D7 – Saved, synced, read leniently:** `autoMove` is written to the state file and the sync file (#13) with the workspace's other settings, and read back from both. A file from before this item has no `autoMove`: every rule off. An `autoMove` that isn't an object, or a rule whose value isn't a string, fails the file as other bad fields do. A rule naming a column the workspace doesn't have (a column deleted on another machine) reads as off and doesn't fail the file. Unknown keys inside `autoMove` are ignored.
- **D8 – The running instance applies the rules:** activity and stops are runtime only and never synced, so only the instance running the card applies its rules; the resulting move reaches other instances through sync like any move. *Why:* no double moves, no new synced state.
- **D9 – Where the logic lives:** which column a change moves a card to is a plain-TS function in `src/core` (workspace, card, event → target or null), unit-tested; the renderer wires it to `CardSessions`' activity and ended events and applies the result through the store. The store's `updateWorkspace` takes an `autoMove` patch and refuses a rule naming a column the workspace doesn't have. Stay out of the files #41 is changing (`attention.ts`, `App.tsx`, `Sidebar.tsx`, `keymap.ts`): subscribe from a module of this item's own.

## Acceptance criteria

- **AC1 – Waiting moves the card:** Given a workspace with columns Backlog, Running, Needs me, Done and its Waiting rule set to Needs me, and a running card in Running, when the card's shell runs `board activity . waiting`, then the card shows at the bottom of Needs me within 2 s, with its `Waiting for you` pill. Running `board activity . question` from Running moves it the same way.
- **AC2 – Working moves the card:** Given the Working rule set to Running and a running card in Needs me, when its shell runs `board activity . working`, then the card moves to the bottom of Running.
- **AC3 – Stopped moves the card:** Given the Stopped rule set to Done and a running card in Running, when its shell runs `exit`, then the card shows Stopped at the bottom of Done. The same when the card is Closed from its menu.
- **AC4 – Off by default and per rule:** Given a new workspace (no rules set), when a card's shell runs `board activity . waiting`, `board activity . working` and then `exit`, then the card stays in its column throughout. Given only the Waiting rule set, `working` and `exit` don't move it.
- **AC5 – Only on a change; manual moves stay:** Given the Waiting rule set to Needs me and a card moved there by `board activity . waiting`, when the user drags it to Backlog and the shell runs `board activity . waiting` again, then the card stays in Backlog. When the shell then runs `board activity . working` and `board activity . waiting`, the card moves to Needs me. `board activity . none` moves nothing.
- **AC6 – Not at launch, not on failed starts:** Given the Stopped rule set to Done and a running card in Running, when the app restarts, then the restored Stopped card is still in Running. A card whose start fails (`Couldn't start`) isn't moved. (e2e for the restart; Vitest for the failed start and SSH failed through the D9 function.)
- **AC7 – The dialog:** Given a workspace, when its Edit dialog opens, then the **Move cards automatically** fieldset shows **When working**, **When waiting for you** and **When stopped**, each on Don't move, listing Don't move then the board's columns in order. Setting When waiting for you to Needs me and pressing Save saves it; reopening shows Needs me. Changing a select and pressing Cancel keeps the saved rule. The Create workspace dialog has no such fieldset.
- **AC8 – Renames and deletes:** Given the Waiting rule on a column, when the column is renamed, then the rule still names it (the Edit dialog shows the new name and AC1 still moves cards there). When that column is deleted, the rule is off (Don't move). (Vitest for the store; e2e for the dialog after a rename.)
- **AC9 – Saved and restored:** Given the Waiting rule set to Needs me, when the app restarts, then the Edit dialog still shows it and the state file holds `"autoMove": {"waiting": "<Needs me's id>"}` for the workspace. A workspace with every rule off has no `autoMove` key.
- **AC10 – Reading files:** Given a state file without `autoMove`, its workspaces read with every rule off. Given a rule naming an unknown column, that rule reads as off and the rest of the file loads. Given `"autoMove": 5` or `"autoMove": {"waiting": 5}`, the file is rejected. (Vitest, `saved-state`.)
- **AC11 – Sync:** the sync file carries `autoMove` (absent when every rule is off) and reading it applies D7; a rule set on one instance reaches the other's Edit dialog. (Vitest, `sync-file` and `sync-apply`.)
- **AC12 – Store:** `updateWorkspace` accepts an `autoMove` patch (each rule a column id of the workspace, or absent for off), refuses one naming an unknown column with an error, and `deleteColumn` turns off every rule naming the deleted column. (Vitest, `workspace-store`.)
- **AC13 – The decision function:** for each event (activity `working`, `waiting`, `question`, null; ended as Stopped, failed, SSH failed) and each rule state, the D9 function returns the column the card moves to, or null when no rule applies, the rule is off or the card is already in that column. (Vitest.)

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Rules on the workspace:** `autoMove` on `Workspace` and the store's patch and checks, `deleteColumn` clearing rules, saved state and sync file read and write (D2, D7), and the Edit dialog's fieldset (D6). Vitest for AC10–AC12; e2e for AC7, AC9 and AC8's dialog part. Satisfies AC7, AC8 (store and dialog), AC9, AC10, AC11, AC12.
2. **S2 – Moving cards:** the D9 decision function, and a renderer module subscribing to `CardSessions`' activity and ended events that moves cards through the store (D3–D5, D8). Vitest for AC13 and AC6's failed starts; e2e for AC1–AC6 and AC8's moves after a rename in a new `e2e/auto-move.spec.ts`. AGENTS.md's test list names it; CONTEXT.md gets an **Automatic moves** entry. Satisfies AC1–AC6, AC8, AC13.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `auto-move.spec.ts` | Set When waiting for you to Needs me; in a card run `board activity . waiting`; card in Needs me |
| AC2 | e2e | Set When working to Running; card in Needs me runs `board activity . working`; card in Running |
| AC3 | e2e | Set When stopped to Done; `exit` in a card, and Close from the menu; card Stopped in Done |
| AC4 | e2e | No rules: the three commands leave the card in place |
| AC5 | e2e | Drag away, repeat `waiting`: stays; `working` then `waiting`: moves |
| AC6 | e2e (restart) + Vitest | Restart with a running card: it stays in its column |
| AC7 | e2e | Edit dialog fieldset, Save, reopen, Cancel; none in Create |
| AC8 | Vitest + e2e | Rename the rule's column: dialog shows new name, cards still move there |
| AC9 | e2e `persistence` style | Restart; dialog shows the rule; state file key |
| AC10 | Vitest `saved-state` | — |
| AC11 | Vitest `sync-file`, `sync-apply` | — |
| AC12 | Vitest `workspace-store` | — |
| AC13 | Vitest | — |

## Stack changes

None.

## Data and migrations

A new optional `autoMove` object on each workspace in the state file and the sync file: `{ "working"?: string, "waiting"?: string, "stopped"?: string }`, each a column id of that workspace; absent when every rule is off. Existing files need no migration: no key means every rule off.

## Out of scope

- Rules on the Create workspace dialog, or in a column's menu.
- Separate rules for `waiting` and `question`; rules on agent status text or on output.
- Moving workspace shells, or moving cards between workspaces.
- Rules applied on another instance than the one running the card; syncing activity.
- Notifications or sounds on a move.

## Open questions

None.
