---
item: 41
type: feature
title: 'Jump to the next card that needs you'
status: approved
branch: claude/41-jump-next-waiting
---

# Jump to the next card that needs you

## Problem

With agents running in several workspaces, a card whose agent waits for the user (activity `Waiting for you` or `Needs your answer`, #31) is only visible on the open workspace's board, and a notification is gone once dismissed. After this ships, each workspace in the sidebar shows how many of its cards and shells wait for the user, and one shortcut (Cmd+J on macOS, Ctrl+Shift+J elsewhere) opens the card that has waited longest, in whatever workspace, and pressing it again goes on to the next one. Renderer only: no IPC, nothing saved beyond the shortcut.

## Domain decisions

- **D1 – Waiting:** a card or shell is **waiting** while its activity is `waiting` or `question` (the pills `Waiting for you` and `Needs your answer`), in any workspace. Its **waiting since** is the moment its activity last became one of the two from anything else (none, `working`, or no activity); a change between `waiting` and `question` keeps it. A card stops waiting when its activity changes to `working` or `none`, when its process stops or starts again (which clears the activity, #31), and when it is deleted. Runtime only, never saved or synced. The open card counts as waiting like any other. *Why:* full auto chose cards and shells, as the Dock badge already counts every terminal (`attention.ts`), so the sidebar counts and the Dock badge agree; the longest-waiting agent is the one most likely blocked. Today `board` answers only calls from cards, so a shell never has an activity and never waits; shells are counted and opened as soon as `board` accepts them (round 2, full auto: not widened here).
- **D2 – The queue:** the waiting cards and shells ordered by waiting since, oldest first; ties (the same millisecond) in the order their activity arrived. Kept in the renderer's attention module, which already tracks the waiting set for the Dock badge, and exposed with a subscription so the sidebar and the palette follow it live. Picking the next one from the queue is a pure function in `src/core` (no DOM).
- **D3 – Shortcut:** a new configurable action `nextWaiting`, labelled **Next waiting card** in Settings' Shortcuts section, default `Cmd+J` on macOS and `Ctrl+Shift+J` elsewhere, recorded, refused and Reset like the others (#31 D8); the terminal never sees it and a held key's auto-repeat does nothing more (#31 D7). It works anywhere in the window (board, card or shell view, empty state) unless a dialog is open (`[aria-modal="true"]`, the command palette included). *Why:* full auto chose them: both are free in the keymap and the app menu; off macOS Ctrl+J alone is the shell's newline, so it takes Shift, as Find and the palette do.
- **D4 – Which card it opens:** when the card or shell open at full size is in the queue, the one after it in the queue (wrapping to the first); otherwise the first in the queue. With A, B, C waiting (oldest first) and nothing open, presses open A, then B, then C, then A. When the queue is empty, or holds only the open card, the shortcut does nothing (no message). *Why:* full auto chose to skip the open card and cycle, so repeated presses always make progress.
- **D5 – Opening it:** exactly as picking it in the command palette (#40 D7): it opens at full size in its workspace, that workspace becomes active when it isn't, and the workspace's remembered view becomes that card (#31 D19). A waiting card is always running (its activity would be cleared otherwise), so nothing starts.
- **D6 – Sidebar count:** each workspace row shows, at its right end, a small amber pill with the number of its waiting cards and shells (D1), hidden at 0, with the tooltip `<n> waiting for you`; the pill sits before the row's edit and delete buttons and stays visible when they show. In the collapsed sidebar the count is a small amber dot with the number on the top-right corner of the workspace's badge (logo or initial, #59), same tooltip. It follows the queue live, whether or not notifications are on (the Dock badge alone follows that setting). The colour is the amber the `Needs your answer` pill already uses. *Why:* full auto chose a count in both states; collapsed is when the sidebar is the only place left to spot it.
- **D7 – Palette row:** the command palette's Actions (#40 D6) gain **Next waiting card**, after Open Default shell in group 2, listed only when D4 would open something (no active workspace needed), showing its shortcut; running it does what the shortcut does.
- **D8 – Nothing else changes:** notifications, the Dock badge, the activity pills and their clearing stay as #31 left them.

## Acceptance criteria

- **AC1 – Sidebar count:** Given workspaces `Alpha` (active) and `Beta`, each with two running plain cards, when one `Beta` card runs `board activity . waiting` and the other `board activity . question`, then `Beta`'s row shows a pill `2` with tooltip `2 waiting for you` and `Alpha`'s row shows none; when one of them runs `board activity . working`, `Beta` shows `1`; when the other card is closed (Close), `Beta` shows no pill.
- **AC2 – Collapsed:** Given AC1 with `Beta` showing `2`, when the sidebar is collapsed, then `Beta`'s badge carries a dot reading `2` with the same tooltip.
- **AC3 – Jump across workspaces, oldest first:** Given `Alpha` active on its board and `Beta`'s card `two` ran `board activity . question` after `Beta`'s card `one` ran `board activity . waiting`, when the user presses Ctrl+Shift+J (Cmd+J on macOS), then `Beta` is active and `one` is open at full size; pressing it again opens `two`; again opens `one`.
- **AC4 – Waiting since kept:** Given `one` waiting before `two`, when `one` runs `board activity . question` (from waiting), then the shortcut from the board still opens `one` first; when `one` runs `working` and then `waiting` again, then `two` comes first.
- **AC5 – Nothing waiting:** Given no waiting card, when the user presses the shortcut on the board, then nothing changes (same workspace, board shown); given only the open card waiting, pressing it keeps that card open.
- **AC6 – From a terminal and behind dialogs:** Given a running plain card open with focus in its terminal and another card waiting, when the user presses the shortcut, then the waiting card opens and the first card's shell received no keys (typing `echo ok` Enter after going back to it runs `echo ok`); with the Settings dialog open the shortcut does nothing.
- **AC7 – Shells count:** Given the queue holds `Beta`'s Default shell id (as it would once `board` accepts calls from shells), then `Beta`'s count is `1` and the picker opens `Beta`'s Default shell (unit level: shells can't set an activity today, D1).
- **AC8 – Rebinding:** Given Settings' Shortcuts section, when the user records `Ctrl+Alt+J` for Next waiting card, then that opens the waiting card and Ctrl+Shift+J no longer does; the settings file holds `"nextWaiting": "Ctrl+Alt+J"`; Reset brings the default back.
- **AC9 – Palette row:** Given a card waiting in `Beta`, when the palette opens, then Actions lists `Next waiting card` with the same shortcut as Settings shows, and running it opens that card; with no card waiting the row is not listed.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Queue and sidebar count:** the waiting-since queue in the attention module with a subscription (D1, D2), the pure next-card picker in `src/core` (D4) unit-tested, and the sidebar pill and collapsed dot (D6). Satisfies AC1, AC2, and AC4/AC5's ordering at unit level.
2. **S2 – Shortcut:** the `nextWaiting` keymap action (defaults, label, Settings row) handled in App's capture-phase handler, opening through the palette's open path (D3, D4, D5). Satisfies AC3, AC4, AC5, AC6, AC7, AC8.
3. **S3 – Palette row and docs:** the Actions row (D7); AGENTS.md's smoke-test list names the new e2e file; CONTEXT.md's Activity entry mentions the sidebar count and the shortcut, and Settings lists the new shortcut. Satisfies AC9.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | e2e `e2e/waiting.spec.ts` | Two workspaces, `board activity` typed in cards, read the sidebar row's pill and tooltip, collapse |
| AC3, AC4, AC5 | Vitest (`src/core` picker) + e2e | Order activities with a pause between, press the shortcut repeatedly, check active workspace and the open card's title |
| AC6 | e2e | Focused terminal, shortcut, then `echo ok` in the first card; Settings open blocks it |
| AC7 | Vitest (`src/core` picker and counts) | Not on the running app: no shell can set an activity today (D1) |
| AC8 | e2e + Vitest (`keymap` defaults) | Record in Settings, settings file entry, Reset |
| AC9 | Vitest (`palette` applicability) + e2e | Open the palette with and without a waiting card |

## Stack changes

None.

## Data and migrations

`drovr-settings.json`'s `shortcuts` may hold a `nextWaiting` entry (only when it differs from the default, #31 D9). Existing files are unchanged; an older Drovr ignores the unknown key.

## Out of scope

- A toast or message when nothing is waiting.
- Counting `Working` cards, or any count on the board's columns.
- Changing notifications, the Dock badge or the activity pills.
- Remembering the queue across restarts or syncing it.

## Open questions

None.

## Decided by full auto

Round 1: default shortcut Cmd+J (macOS) / Ctrl+Shift+J; cards and shells count; oldest = longest waiting by when the activity last became waiting or question; skip the open card and cycle; nothing happens silently when none waits; amber count pill on the row, a dot on the badge when collapsed; a `Next waiting card` palette row while one waits.
