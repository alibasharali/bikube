---
item: 31
type: feature
title: Modernize and polish
status: draft
branch: claude/31-modernize-polish
---

# Modernize and polish

## Problem

Drovr works end to end, but it looks dated in places: an open card spends its top row on four text buttons (Back, Split right, Split down, Close), its shortcuts are hard-coded, and a board card shows one cramped line that says little about what the agent inside is doing. After this ships, an open card is all terminal, every card action has a shortcut the user can change in Settings, a running card can be stopped straight from the board, and a bigger card shows what the agent in it is doing: a Claude Code card says by itself whether it is *Working*, *Waiting for you* or *Needs your answer*, and Claude keeps a one-line summary of its work on the card. The whole UI gets a cleaner, consistent look with a real icon set.

Builds on #9 (`board` and agent status), #11 (panes and their shortcuts), #10 (Settings), #25 (`board` in SSH cards) and #5/#21 (startup commands); all merged.

## Domain decisions

### The open card

- **D1 – No bar:** the full-size card view has no header at all: no title, SSH location, status line or buttons. The panes fill the whole area right of the sidebar. The card's title and status show only on the board and in the sidebar. *Why:* round 1 Q1: more terminal; the rejected options kept a slim bar or a ⋯ menu.
- **D2 – Back:** going back to the board is clicking a workspace in the sidebar (any workspace, as today) or the **Back** shortcut (D6). No Escape, no ← icon. The card keeps running, as Back does today. *Why:* round 1 Q2; Escape belongs to Claude Code and vim.
- **D3 – Closing a pane with the mouse:** an extra pane shows a small × (lucide `X`, accessible name `Close pane`) in its top-right corner only while the pointer is over that pane or the × has keyboard focus; clicking it closes that pane as today's × does (no confirmation). The main pane has no ×. *Why:* round 2 Q5.
- **D4 – Close pane on the main pane:** the **Close pane** shortcut in the focused extra pane closes it at once; in the main pane it opens the Close confirmation for the card (#7), exactly like the **Close card** shortcut. *Why:* round 2 Q7.

### Shortcuts

- **D5 – Configurable actions:** six shortcuts are configurable: **Back to board**, **Split right**, **Split down**, **Close pane**, **Close card** (opens the Close confirmation; does nothing on a card that isn't running) and **Open Settings**. The first five act only while a card is open at full size and the keyboard isn't owned by a dialog (as today's capture listener); **Open Settings** acts anywhere no dialog is open (as today). Every other shortcut (card moves with Alt+Arrows on the board, copy and paste in a terminal) stays fixed. *Why:* round 1 Q5.
- **D6 – Defaults:**

  | Action | macOS | Linux (and others) |
  |---|---|---|
  | Back to board | Cmd+Shift+B | Ctrl+Shift+B |
  | Split right | Cmd+D | Ctrl+Shift+D |
  | Split down | Cmd+Shift+D | Ctrl+Shift+E |
  | Close pane | Cmd+W | Ctrl+Shift+W |
  | Close card | Cmd+Shift+W | Ctrl+Shift+Q |
  | Open Settings | Cmd+, | Ctrl+, |

  The first three and the last are today's (#4 D8, #10 D5, #11 D4). On macOS Drovr's application menu keeps its standard items but its Close Window item has no Cmd+W, so Cmd+W reaches the card view; with no card open Cmd+W does nothing. *Why:* round 2 Q6; Ctrl+W and Ctrl+D are terminal keys off macOS, so the defaults there add Shift.
- **D7 – A shortcut:** one key plus modifiers. Stored and shown as text: modifiers in the fixed order `Ctrl`, `Alt`, `Shift`, `Cmd`, then the key, joined with `+` (`Ctrl+Shift+D`, `Cmd+,`); the key is a single printable character upper-cased (letters), or a named key (`ArrowUp`, `Enter`, `F5`…). It must include Cmd or Ctrl or Alt. Matching compares exactly: every listed modifier pressed and no other (Shift included), and the key matched case-insensitively; like today, a match swallows the whole key (keydown, keypress, keyup) so the terminal never sees it, and the action runs on keydown only, once per press (auto-repeat swallowed). *Why:* round 1 Q6.
- **D8 – Changing a shortcut in Settings:** the Settings dialog gets a **Shortcuts** section listing the six actions, each with a field showing its current shortcut and a **Reset** button (disabled while it is the default). Clicking the field puts it in recording mode (`Press a shortcut…`); the next key press with Cmd/Ctrl/Alt and a non-modifier key becomes the new value; Escape cancels recording; a press with no Cmd/Ctrl/Alt shows `Use Cmd, Ctrl or Alt with a key` (macOS: Cmd; elsewhere: Ctrl) and keeps recording. A combination that is another action's current shortcut, or a fixed one (Alt+ArrowUp/Down/Left/Right; copy/paste: Cmd+C/Cmd+V on macOS, Ctrl+Shift+C/Ctrl+Shift+V elsewhere; on macOS Cmd+Q, Cmd+H, Cmd+M), is refused with `Already used by <action>` (`Already used by Copy`, `…by Move card`, `…by Quit`…) and the old value stays. Changes take effect like the dialog's other fields (on Save) and are kept across restarts. *Why:* round 1 Q6; round 2 Q8: Settings is the only place shortcuts are listed.
- **D9 – Saved shortcuts:** `drovr-settings.json` (version stays 1) gains an optional `shortcuts` object keyed by action id (`back`, `splitRight`, `splitDown`, `closePane`, `closeCard`, `settings`) holding only shortcuts that differ from this OS's default, as D7 text. Reading it is per field, like the other settings (#10 D7): a missing, unknown, malformed, modifier-less or duplicate (two actions with the same shortcut: both fall back) entry falls back to the default; unknown keys are ignored. Saving validates the whole set and rejects it if any entry is invalid or two actions share a shortcut. Settings, including shortcuts, are per machine and never synced (#13). *Why:* an old file keeps working; a bad hand edit costs one shortcut, not all settings.

### The board card

- **D10 – Stop button:** a running card shows a ■ icon button (lucide `Square`, accessible name `Close`, tooltip `Close`) on its status row. Clicking it opens the same Close confirmation as the card menu's Close (#7) and never opens the card. Cards that aren't running show no button. Clicking the card itself opens it as today: a running card's terminal, or a stopped one started with its startup command. The card menu keeps its Close item. *Why:* round 1 Q3, Q4: a button, no on/off switch.
- **D11 – Card layout:** columns become 300 px wide (from 272 px). A card shows, top to bottom: the title and startup tag (as today); a status row with the status label (`Running`, `Stopped`, `SSH failed: …`, `Couldn't start: …`), the activity pill (D13) when set, and the stop button (D10) at the right; the agent status (#9 D8) when set, on up to 2 lines then an ellipsis, its full text in a tooltip; the last output line in the monospace terminal font on 1 line with an ellipsis. Agent status no longer replaces the last output line: both show. A card that isn't running shows only the title, tag and status row. The `Running · <text>` form goes away everywhere. *Why:* round 1 Q7.

### Agent activity

- **D12 – `board activity`:** a new board command `board activity <card> working|waiting|question|none` sets the card's **activity**; `none` clears it. The card reference, the calling-card rules, the result and error texts are those of `board status` (#9 D2, D3, D9; a card that isn't running fails with `board: "<title>" is not running`); any other value prints usage to stderr and exits 2. The usage text lists the new command. It works the same in local and SSH cards and their extra panes (#25: the remote perl and python clients learn it too). The protocol keeps `v: 1` and gains `{"command":"activity","card":…,"activity":…}`. Like agent status, activity is runtime only: cleared when the card's process stops or fails and when it starts again, never saved or synced. *Why:* round 2 Q2: a field of its own, separate from free text.
- **D13 – Activity pill:** while set on a running card, the activity shows as a small coloured pill on the status row: `working` → `Working` (accent blue), `waiting` → `Waiting for you` (green), `question` → `Needs your answer` (amber). *Why:* round 2 Q2.

### Claude Code reports its status

- **D14 – How Claude gets the hooks:** a Claude Code card's start line becomes `claude --settings "$DROVR_CLAUDE_SETTINGS" --session-id <id>` the first time and `claude --settings "$DROVR_CLAUDE_SETTINGS" --resume <id> || claude --settings "$DROVR_CLAUDE_SETTINGS" --session-id <id>` after (#5 D5), in the main pane only. `DROVR_CLAUDE_SETTINGS` is the absolute path of a Claude settings file Drovr provides, set in the environment of every card shell next to #9 D3's variables: locally a static file in Drovr's bin directory (shipped like `board`, outside the asar); in SSH cards a copy the remote command writes into the session's private directory beside `board` and removes with it (#25), exporting the variable there. Nothing is written into the user's repository or `~/.claude`; Claude merges these hooks with the user's own. Codex, Gemini CLI, OpenCode, Shell and Custom cards are unchanged. *Why:* round 2 Q1; round 1 Q9: Claude Code only.
- **D15 – The hooks:** the settings file holds only hooks, each a command that calls `"$DROVR_BIN/board"` for the calling card (`.`), discards its output and always exits 0 with a 5 s timeout, so a missing `board`, an unreachable Drovr or a host without perl/python never disturbs Claude:
  - `UserPromptSubmit` → `activity working`;
  - `PreToolUse` → `activity question` when the tool is `AskUserQuestion` (Claude asking the user), else `activity working`;
  - `Stop` → `activity waiting`;
  - `Notification` for a permission prompt or an input request (not the idle reminder) → `activity question`;
  - `SessionStart` → prints the D16 instruction to stdout (which Claude adds to its context), sets nothing.
  *Why:* round 2 Q3; asking a question through a tool is "needs your answer", not "working".
- **D16 – The instruction:** the `SessionStart` hook gives Claude this text (no backslashes or double quotes, so the SSH copy stays fish-safe):

  > You are running inside a Drovr card, a kanban board card that shows your status. At the end of every turn, run: "$DROVR_BIN/board" status . '<one line>' — one short line, at most 80 characters, saying what you did or what you are waiting for, for example: Tests green, PR ready for review. Do it silently: don't mention it to the user. If the command fails, ignore it.

  (The quote characters shown around `$DROVR_BIN/board` and `<one line>` are part of the text; the implementation may store it in a file beside the settings file to avoid escaping.) *Why:* round 2 Q4.

### Visual refresh

- **D17 – Icons and look:** `lucide-react` (MIT) provides every icon: the menu buttons (⋯ → `Ellipsis`), add buttons (`Plus`), close and delete (`X`, `Trash2`), the sidebar collapse toggle (`PanelLeftClose`/`PanelLeftOpen`), settings (`Settings`), the SSH marker (`Server`), the stop button (`Square`). Text glyphs used as icons go away. The stylesheet gets one spacing scale (4/8/12/16/24 px), one radius (8 px cards, dialogs and inputs; 6 px buttons and pills), one type scale (12/13/14/16 px, the system UI font) and subtle card shadows and hover states, in both themes. Every control keeps its accessible name and test id unless this spec removes it. *Why:* round 1 Q10.

## Acceptance criteria

Workspace `alpha` (`/tmp/drovr-alpha`) has the default columns; card `api` is a Shell card in `Backlog`. "Mod" is Cmd on macOS and Ctrl elsewhere; tests run on Linux, so the Linux defaults apply.

- **AC1 – No bar:** Given `api` opened, then the view shows no title, status text or buttons (`card-back`, `pane-split-right`, `pane-split-down`, `card-close` don't exist), and the terminal's top edge is the top of the window's content area.
- **AC2 – Back:** Given `api` open, when the user presses Ctrl+Shift+B, then the board shows and `api` reads `Running`; given `api` open again, when the user clicks `alpha` in the sidebar, then the board shows and `api` is still `Running`.
- **AC3 – Split and close pane by shortcut:** Given `api` open, when the user presses Ctrl+Shift+D then Ctrl+Shift+E, then 3 panes show; when they press Ctrl+Shift+W in the focused extra pane, then 2 panes show; when they focus the main pane and press Ctrl+Shift+W, then the Close confirmation opens; Cancel keeps 2 panes running.
- **AC4 – Close card by shortcut:** Given `api` open with 2 panes, when the user presses Ctrl+Shift+Q and confirms, then the board shows and `api` reads `Stopped`.
- **AC5 – Hover ×:** Given `api` open with an extra pane, then that pane's `Close pane` × is hidden until the pointer is over the pane; clicking it closes the pane; the main pane never shows one.
- **AC6 – Change a shortcut:** Given Settings open, when the user clicks Split right's field and presses Ctrl+Alt+R and saves, then in `api` Ctrl+Alt+R splits right and Ctrl+Shift+D doesn't (the terminal gets it); after a restart Settings still shows `Ctrl+Alt+R` and `drovr-settings.json` holds `"shortcuts":{"splitRight":"Ctrl+Alt+R"}`; Reset brings back `Ctrl+Shift+D`, and the saved file no longer lists `splitRight`.
- **AC7 – Refused shortcuts:** Given Settings open and Split right's field recording, pressing `R` alone shows `Use Ctrl or Alt with a key`; pressing Ctrl+Shift+B shows `Already used by Back to board`; pressing Ctrl+Shift+C shows `Already used by Copy`; in every case the field keeps `Ctrl+Shift+D`. Escape stops recording without a change.
- **AC8 – Bad settings file:** Given `drovr-settings.json` with `"shortcuts":{"back":"B","splitRight":"Ctrl+Alt+R","closePane":"Ctrl+Alt+R","bogus":"Ctrl+K"}` and a valid theme, when the app starts, then Back is `Ctrl+Shift+B`, Split right `Ctrl+Shift+D`, Close pane `Ctrl+Shift+W`, and the theme is kept.
- **AC9 – Stop from the board:** Given `api` running, when the user clicks its `Close` (■) button on the board, then the Close confirmation opens and the card doesn't open; confirming makes `api` read `Stopped` with no ■ button; clicking `api` then opens and starts it.
- **AC10 – Card layout:** Given `api` running, when it runs `board status . "running tests"` and then `echo hello`, then the card shows `Running`, `running tests` and `hello` on separate lines (the last in the terminal font); a 150-char status shows on at most 2 lines with the full text in its tooltip; `board status . ""` leaves only `Running` and `hello`. Columns are 300 px wide.
- **AC11 – Activity:** Given `api` running, when it runs `board activity . working`, then its card shows a `Working` pill; `waiting` shows `Waiting for you`; `question` shows `Needs your answer`; `none` removes it; `board activity . busy` prints usage to stderr and exits 2; after `exit` the card reads `Stopped` with no pill, and reopening it shows none. The same works from an extra pane and from an SSH card through the fake `ssh`.
- **AC12 – Claude start line:** Given a Claude Code card `cc`, when it is opened the first time, then the fake `claude` receives `--settings <path> --session-id <id>` where `<path>` exists and is valid JSON with hooks for `UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification` and `SessionStart`; reopened after a stop it receives `--settings <path> --resume <id>`. In an SSH card the path is inside the session's private directory and is gone after the session ends.
- **AC13 – Hooks drive the card:** Given `cc` running, when each hook command from the settings file is run in `cc`'s shell with Claude's sample hook input on stdin, then the card shows `Working` after `UserPromptSubmit` and after `PreToolUse` for `Bash`, `Needs your answer` after `PreToolUse` for `AskUserQuestion` and after a permission `Notification`, `Waiting for you` after `Stop`; `SessionStart` prints the D16 text; every command exits 0, also with `DROVR_SOCKET` pointing at no listener.
- **AC14 – Look:** the board, sidebar, card menus, dialogs and an open card render with lucide icons and the D17 tokens in both Dark and Light themes; screenshots of each in both themes are attached to the PR. All existing smoke tests pass with their interactions moved from the removed buttons to the shortcuts or the sidebar.
- **AC15 – Checks:** `.claude/check.sh`, `xvfb-run -a npm run test:smoke` and `xvfb-run -a npm run test:packaged` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Configurable shortcuts:** a core keymap module (D6 defaults per OS, D7 text format, parsing a key event, matching, D8's refusal rules and texts, D9 per-field reading and whole-set validation), replacing the hard-coded matchers; the settings file and IPC carry `shortcuts`; the card view and app listeners use the keymap and gain Close pane (D4) and Close card; the macOS menu frees Cmd+W; the Shortcuts section in Settings (D8). Vitest for the core rules; e2e in `e2e/settings.spec.ts` and `e2e/panes.spec.ts`. Satisfies AC3, AC4, AC6, AC7, AC8.
2. **S2 – No bar:** the card view drops its header (D1); hover × on extra panes (D3); every e2e spec using `card-back`, `pane-split-*` or `card-close` moves to the shortcuts or the sidebar (a shared helper in `e2e/`). Satisfies AC1, AC2, AC5.
3. **S3 – Board card and stop button:** the D11 layout and 300 px columns, the D10 stop button with the Close confirmation; `cardStatus` returns label, agent status and last line separately; e2e that read `Running · …` updated. Satisfies AC9, AC10.
4. **S4 – Activity:** `board activity` in the CLI arguments, protocol, request validation and usage (D12), the remote perl and python clients, the store's runtime activity cleared on stop/start, the pill (D13); `CONTEXT.md` (**activity**, **board command**) and `AGENTS.md` updated. Vitest for args, protocol, commands and remote clients; e2e in `e2e/board-cli.spec.ts` and `e2e/ssh.spec.ts`. Satisfies AC11.
5. **S5 – Claude Code hooks:** the settings file and instruction (D15, D16) in the bin directory and packaged outside the asar, `DROVR_CLAUDE_SETTINGS` in the card env and in the SSH remote command (written and removed with `board`), the new start lines (D14); `CONTEXT.md` (**startup command**) updated. Vitest for the start lines, env and remote command; e2e with the fake `claude` logging its arguments and running each hook command (AC12, AC13); `e2e/packaged.spec.ts` checks the file is in `resources/bin`. Satisfies AC12, AC13.
6. **S6 – Visual refresh:** add `lucide-react`; replace glyph icons; the D17 spacing, radius, type and shadow tokens in the stylesheet for both themes; screenshots. Satisfies AC14, AC15.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e | Open `api`; assert the old test ids are absent; compare the terminal's bounding box top with the main area's |
| AC2 | e2e | Ctrl+Shift+B; reopen; click `alpha` in the sidebar; read `api`'s status |
| AC3 | unit (keymap) + e2e | Press the shortcuts; count `.xterm` panes; check the Close dialog |
| AC4 | e2e | Ctrl+Shift+Q; confirm; read the card's status |
| AC5 | e2e | Hover the extra pane; assert the × visibility before and after; click it |
| AC6 | unit (settings file) + e2e | Record a shortcut in Settings; use it in a card; restart; read the file; Reset |
| AC7 | unit (keymap) + e2e | Press each refused combination while recording; read the message and the field |
| AC8 | unit (settings file) + e2e | Write the file before launch; read the Shortcuts section |
| AC9 | e2e | Click the ■ on the board; check the dialog and that the board still shows; confirm; reopen |
| AC10 | unit (card status) + e2e | Run the commands in `api`; Back; read the card's lines and tooltip; measure the column |
| AC11 | unit (args, protocol, remote clients) + e2e | Run each `board activity` in local, extra-pane and fake-SSH cards; read the pill; `exit` and reopen |
| AC12 | unit (start line, remote command) + e2e (fake `claude` logs argv) | Open `cc`; read the fake's log; parse the settings file; SSH variant checks the path and its removal |
| AC13 | unit (settings file contents) + e2e | Run each hook command with sample JSON on stdin in `cc`; read the pill; `echo $?`; repeat with a dead `DROVR_SOCKET` |
| AC14 | manual screenshots + existing smoke tests | Screenshot board, sidebar, menu, Settings, Close dialog and an open card in Dark and Light |
| AC15 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke`, `xvfb-run -a npm run test:packaged` | CI green |

The developer checks on macOS, with the real Claude Code in a card of the packaged app: Cmd+D/Cmd+Shift+D/Cmd+W/Cmd+Shift+W act on the card and Cmd+W never closes the window; the card's pill goes `Working` while Claude works, `Needs your answer` on a permission prompt, `Waiting for you` when it finishes, and the card shows Claude's one-line status after each turn.

## Stack changes

None. `lucide-react` is an npm UI library inside the existing React renderer (round 1 Q10), not a new framework, database, auth, hosting or service.

## Data and migrations

`drovr-settings.json` gains an optional `shortcuts` object (D9); the version stays 1 and existing files read as all defaults. The saved board state and the sync file are unchanged: activity, like agent status, is runtime only. A new static file, the Claude settings file (and its instruction text), ships in Drovr's bin directory.

## Out of scope

- Status hooks or instructions for Codex, Gemini CLI, OpenCode, or `claude` typed by hand in a Shell or Custom card (they can still call `board status` / `board activity` themselves).
- Configuring the fixed shortcuts (card moves, copy and paste), chords of several keys, or per-workspace shortcuts.
- Shortcut hints outside Settings (on cards, menus or the terminal).
- An on/off switch, or starting a card in the background from the board.
- Saving or syncing activity or agent status; notifications when a card needs an answer.

## Open questions

None.
