---
item: 75
type: feature
title: Agent tab in the side panel
status: approved
branch: claude/75-agents-tab
---

# Agent tab in the side panel

## Problem

While a Claude Code card works, the only way to follow what it does is to scroll its terminal: commands show as one long `Bash(cd …; git pull … && …)` line, subagents and background commands are easy to miss, and there is no readable account of what the last prompt changed. After this ships, the side panel has an **Agent** tab beside Files and Shells that shows the current conversation of the open Claude Code card, or of Claude Code run in an open workspace shell (Default, named or temporary), live: the model, its context bar and todo list, the agents at work, what changed (per prompt or for the whole session, without code), and every command it ran, newest first and readable.

## Domain decisions

- **D1 – The tab:** a third side panel tab named `Agent`, after Files and Shells (`SIDE_PANEL_TABS` gains `agent`, saved as `sidePanelTab` like the others). It exists beside the board, beside an open card or shell, and in a card window's panel header (#53). *Why:* developer's pick (round 1 Q1) over Agents, Monitor and Activity.
- **D2 – Which cards and shells:** the tab shows a conversation for a **local** card whose startup is Claude Code (`kind: 'claude'`), and for a **local workspace shell** (the Default shell, a named shell or a temporary one, #66) in which Claude Code has reported a session (D3a). Everything else shows one short message in the tab body, and nothing is read:
  - the board in front (no card open): `Open a Claude Code card to see its agent.`
  - a workspace shell with no Claude Code session reported since it started: `Run claude in this shell to see its agent here.`
  - a card with another startup (plain shell, custom command, Codex, Gemini CLI, OpenCode, Pi): `The Agent tab follows Claude Code cards.`
  - a card in an SSH workspace: `The Agent tab isn't available over SSH.`
  *Why:* round 1 Q2 and Q3: only Claude Code's local transcripts can be read; other agents and remote transcripts are out of scope. Shells: the developer's change request ("if we are running claude code in a terminal (default shell or temporary terminal), the tab should work there too"); named shells are workspace shells of the same kind, so they get it too.
- **D3 – Which conversation:** the card's current Claude Code session, `agentSessionId` (kept up to date by the `board session` hook on prompt submit and session start, so after `/clear` the tab follows the new session). The transcript is `<home>/.claude/projects/<encodeProjectFolder(folder)>/<agentSessionId>.jsonl` and its subagents' files under `<agentSessionId>/subagents/`, `home` being `BIKUBE_HOME_DIR` else the OS home, `folder` the card's own directory (its worktree's path for a worktree card, else the workspace folder: the folder the Files tab shows beside it). No earlier sessions, no picker. A card whose transcript doesn't exist yet (never started, or started and no prompt sent) shows `No conversation yet.` *Why:* round 2 Q8.
- **D3a – A shell's conversation:** Claude Code typed in a local workspace shell already gets Bikube's hooks (shell integration's `claude` function, #92), whose `board session .` and `board usage .` today do nothing for a shell. From a running shell they now keep, **runtime only** (like its `status` and `activity`: never in the state file or the Sync folder, cleared when the shell stops or restarts), the shell's latest Claude Code session id and its usage. The tab shows that session's transcript: since Claude Code may run in any directory the user `cd`'d to, main finds it as `<home>/.claude/projects/<any one folder>/<session id>.jsonl` (one directory level, the session id a UUID, the newest file if several match), with its subagents beside it as in D3. After Claude Code exits the tab keeps showing that session until the shell stops or reports another. The shell's **folder** for D9's grouping and opening is the folder its Files tab shows (the workspace folder, or its `runIn` worktree). The main agent's `Running`/`Idle` (D8) reads the shell's activity; its context bar (D7) reads the kept usage with the same `contextUse`; a background command is `Stopped` once the shell isn't running. Only the main pane's Claude Code counts for a shell (as for a card: `board` from an extra pane names its card or shell).
- **D4 – Reading, safely:** main alone reads transcripts. The renderer asks with the card's folder and session id only (a shell's request with the session id alone, D3a); main refuses (an error state, nothing read) a folder that isn't an absolute existing directory or a session id that isn't a UUID, builds or finds the path itself under `<home>/.claude/projects`, and reads nothing else. Main frame only, as `agentSetup:*`. Transcripts are parsed by a Node-free module (Vitest on fixture lines) into one **agent summary** (D6–D10); main tails the files: it keeps, per transcript, the byte offset read and the parse state, and on each request parses only the bytes appended since, yielding to the event loop every 200 lines (as `claude-stats.ts` does) so PTY output keeps flowing. A file that shrank or was replaced is read again from the start. Unparseable lines are skipped. *Why:* AGENTS.md's IPC rules; a long session's transcript can be many MB, re-reading it every second would stall main.
- **D5 – Live:** while the Agent tab is shown for a card or shell (in any Bikube window), the renderer asks for its summary about every second (1 s after the previous answer), and stops asking when the tab is hidden, the panel is hidden, or another card or the board is in front; main drops a transcript's tail state 60 s after its last request. An unchanged transcript returns `unchanged` so nothing re-renders. *Why:* round 2 Q7.
- **D6 – Layout:** from top to bottom: the **header** (model, context bar, todos), then three groups, **Agents**, **What changed**, **Commands**, each a collapsible heading (chevron, name, count of rows shown, `aria-expanded`), all open the first time, the collapsed ones remembered for the run of the app (not per card, not across a restart). The body scrolls vertically and never sideways down to the panel's 200 px minimum width; long text ellipsizes or wraps. *Why:* round 2 Q9.
- **D7 – Header:**
  - **Model:** the model of the main agent's latest assistant entry, as the transcript names it (`claude-opus-…`), shortened by nothing.
  - **Context bar:** exactly the board card's context bar (#50): the same component, the same data (the card's usage as the card shows it; a shell's kept usage, D3a) and the same `contextUse` calculation, label `42% context` and the same tooltip; absent when the card shows none. *Why:* round 2 Q6, the developer's own answer: "just like the context bar on the card".
  - **Todos:** the latest todo list the main agent wrote (the last `TodoWrite` tool use's `todos`, or the list built from `TaskCreate`/`TaskUpdate` tool uses when the session uses those), as `done/total` with a thin progress bar and each item on its own line: completed struck through and dimmed, in progress in the accent with its `activeForm` text, pending plain. No todos: the todo part is absent.
- **D8 – Agents group:** one row for the main agent, then one per subagent (a `Task` or `Agent` tool use), then one per background command (a `Bash` tool use with `run_in_background: true`), newest first after the main agent. Each row: an icon by kind, then two lines: a name (`Main agent`; the subagent's `subagent_type`, else `Subagent`; the background command's description, else its first 60 characters) with its status on the right (`Running` with a spinner, `Done` with a check, `Failed`, `Stopped`, `Idle`: a coloured icon and a muted word, no chip), and under it the subagent's task `description` with its duration (live while running: `41s`, `3m 12s`, `1h 4m`) and for a subagent its number of tool uses on the right. The main agent is `Running` while the card's activity is working (#31), else `Idle`. A subagent is running from its tool use until its tool result (failed when the result is an error). A background command is running until the transcript shows it ended (a `BashOutput` or `KillShell` result naming its shell id with a final status, or a background-task notification) and is `Stopped` once the card's shell isn't running. Done subagents and background commands older than the latest 5 fold into one row, `N finished`, which expands. A subagent's tool count comes from its own transcript under `subagents/` (matched by its prompt) or its tool result's total; while neither is known it is left out. *Why:* round 2 Q5, image 1's Background tasks card.
- **D9 – What changed group:** a select at the top picks the view: `Last prompt` (the default, each time the tab shows a new card), `Whole session`, or any earlier prompt (`#<n> <first 50 characters of the prompt>`, newest first). A **prompt** is a main-agent user entry the user typed (text content, not a tool result, not a meta or command-output entry); it covers every entry until the next prompt, subagents' included.
  - **Files:** only the agents' own file changes, never git: `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tool uses whose result isn't an error or a denial, plus deletes and renames read from simple commands: a `Bash` command whose step (split at `&&`, `||`, `;`) is `rm [-f|-r|-rf …] <paths>`, `git rm <paths>`, `mv <a> <b>` or `git mv <a> <b>` with plain paths (no globs, variables or substitutions), the command not failed. Each file gets one badge for the view: `New` (a `Write` that created it), `Edited`, `Deleted`, `Renamed` (shown `old → new`); a file created then edited reads New, created then deleted is left out, edited then deleted reads Deleted.
  - **Size:** each file's lines added and removed (`+12 −3`, green and red), from the tool result's structured patch when present, else counted from the old and new strings (a `Write` counts its content's lines as added), with a small bar whose length is the file's total against the largest in the view. Deleted and renamed files show no size.
  - **Grouping:** files grouped by folder relative to the card's folder (`src/core`, the folder itself as `./`), folders sorted by name, files by name; files outside the card's folder under their absolute folder, after the rest. Above the list, on the view select's line: `<n> files · +<added> −<removed>`.
  - **Opening:** clicking a file inside the card's folder opens it with Settings > Editor through the Files tab's open (`files:open`, its notes and error line); a deleted file, or one outside the folder, isn't clickable.
  - No changes in the view: `No file changes in this prompt.` (or `… in this session.`).
  *Why:* round 1 Q4, Q5; round 2 Q1, Q2. No code is ever shown.
- **D10 – Commands group:** every `Bash` tool use of the session, the main agent's and every subagent's, newest first. Each row is two lines. The first: a status icon (a check for `OK`; a cross for `Failed · exit <n>` from the result's exit code, `Failed` without one; a no-entry sign for `Denied` when the result is the user rejecting the tool use; a spinner for `Running` while there is no result; a terminal for `Background` for `run_in_background`; no chip, the full status word read out), Claude's `description` (the command's first line when there is none) on one ellipsized line, the subagent's name as a tag on a subagent's command, then on the right `exit <n>` (or `Failed`), `Denied` or `Background` in muted words for those statuses, and the duration (result minus tool use timestamps). The second, only when Claude gave a description: the command in monospace on one ellipsized line, lined up with the description. Clicking a row (or Enter on it) expands it: the full command laid out one step per line, split at top-level `&&`, `||`, `;` and `|` (never inside quotes, `$(…)` or a heredoc), each operator at the start of its line in a gutter, so every step's command (and its wrapped lines) starts in one column; coloured: the program name in the accent, flags muted, quoted strings in the string colour, operators in the danger/notice colour, all from app theme tokens; `cd <dir>` steps dimmed; then the last 20 lines of its output (the result's text, each line cut at 500 characters), and a `Copy` button that copies the original command, with the time it started (`Started 14:32`) beside it. At most the newest 200 rows show, with `Show all` below. *Why:* round 1 Q6, Q7; round 2 Q3, Q4. Allowed automatically versus approved isn't in the transcript, so it isn't shown.
- **D11 – Size limits:** the summary main sends caps each text it carries (prompt 50 characters for the picker plus 2,000 for its own, command 4,000, output 20 lines × 500 characters, description 300) and keeps at most 2,000 commands, 500 subagents and background commands, and 5,000 file changes, dropping the oldest. *Why:* a runaway session must not flood IPC or the renderer.
- **D12 – Errors:** a transcript that can't be read (permissions, a vanished folder) shows `Couldn't read the conversation: <reason>` in the tab with the last summary kept below it; the next successful read clears it.

## Acceptance criteria

All transcripts below are fixture JSONL files written by the test into a fake home (`BIKUBE_HOME_DIR`) at the path D3 names, for a local Claude Code card whose `agentSessionId` is the fixture's id.

- **AC1 – Tab:** Given the side panel is shown beside the board, when the user clicks the `Agent` tab (the third, after Files and Shells), then it is selected and its body reads `Open a Claude Code card to see its agent.`; after a restart it is still the selected tab.
- **AC2 – Not a Claude Code card:** Given the Agent tab is selected, when a plain card (Custom command `:`) is opened, the body reads `The Agent tab follows Claude Code cards.`; when the Default shell is opened before Claude Code ran in it, `Run claude in this shell to see its agent here.`; when a Claude Code card of an SSH workspace is opened, `The Agent tab isn't available over SSH.`
- **AC3 – No conversation:** Given a local Claude Code card with no transcript file, when it is opened with the Agent tab selected, the body reads `No conversation yet.`
- **AC4 – Header:** Given a transcript whose last main-agent assistant entry has model `claude-opus-4-8` and a `TodoWrite` with 3 todos (1 completed, 1 in progress `Running tests`, 1 pending), and the card shows `42% context` on the board, when the card is opened with the Agent tab selected, then the header shows `claude-opus-4-8`, a context bar reading `42% context` with the board card's tooltip text, `1/3`, the completed todo struck through and `Running tests` in the accent.
- **AC5 – Live:** Given AC4's card open on the Agent tab, when the test appends a `Bash` tool use (description `Run unit tests`) to the transcript, then within 3 s the Commands group's first row reads `Run unit tests` with `Running`; when it appends that tool use's result with exit code 0, the row reads `OK` with a duration.
- **AC6 – Commands rows:** Given a transcript with three `Bash` commands in order: `git status` (description `Show status`, ok), `npm test` (description `Run tests`, result an error `Exit code 1`), and `rm -rf build` (description `Remove build`, rejected by the user), then the Commands group's rows top to bottom are `Remove build` → `Denied`, `Run tests` → `Failed · exit 1`, `Show status` → `OK`, each with its command in monospace beneath, and the group's count reads `3`.
- **AC7 – Command detail:** Given AC6, when the user clicks the `Run tests` row, then it shows `cd /repo`, `&& npm test`, `| tail -5` (for the command `cd /repo && npm test | tail -5`) on three lines with `cd /repo` dimmed, the last lines of its output, and `Copy`; clicking `Copy` records the command `cd /repo && npm test | tail -5` as the clipboard write (`recordClipboardWrites`).
- **AC8 – Subagents:** Given a transcript with a `Task` tool use (`subagent_type` `Explore`, description `Find the panel code`) without a result and a subagent transcript whose `Bash` command is `ls src` (description `List src`), then Agents shows `Main agent` and `Explore` / `Find the panel code` / `Running`, and Commands shows `List src` tagged `Explore`; when the test appends the `Task` result, the Explore row reads `Done` with a duration.
- **AC9 – Background command:** Given a `Bash` tool use with `run_in_background: true` (description `Start dev server`) and no end in the transcript, while the card's shell runs, then Agents lists `Start dev server` as `Running`, and its Commands row shows `Background`.
- **AC10 – What changed, last prompt:** Given a transcript with prompt 1 (`Add the panel`), which `Write`s `src/a.ts` (new, 10 lines) and `Edit`s `src/b.ts` (+2 −1), and prompt 2 (`Rename b`), which runs `git mv src/b.ts src/c.ts` and `Edit`s `docs/x.md` (+1 −0), when the card is opened on the Agent tab, then What changed shows `Last prompt` selected, `2 files · +1 −0`, under `docs` `x.md` `Edited` `+1 −0`, under `src` and `b.ts → c.ts` `Renamed`.
- **AC11 – Whole session and picker:** Given AC10, when the user picks `Whole session`, then it shows `a.ts` `New` `+10`, `b.ts → c.ts` `Renamed`, `x.md` `Edited`; when the user picks `#1 Add the panel`, then it shows `a.ts` `New` and `b.ts` `Edited` `+2 −1` and no rename.
- **AC12 – Open a changed file:** Given AC10 with a fake `code` on the fake login PATH, when the user clicks `x.md`, then the fake `code` is run with the card's folder and `docs/x.md`'s absolute path, as the Files tab opens a file.
- **AC13 – Collapse:** Given the Agent tab with all groups open, when the user clicks the `Commands` heading, then its rows are hidden and it reads `aria-expanded="false"`; opening another Claude Code card keeps Commands collapsed; after a restart it is open again.
- **AC14 – Stops when hidden:** Given AC5's card open on the Agent tab, when the user selects the Files tab, then main receives no further summary request for it (counted through a development-build hook) until the Agent tab is selected again.
- **AC15 – Session switch:** Given a card on the Agent tab showing session A's commands, when `board session . <B>` runs in the card for a session B whose transcript has one command `Echo B`, then within 3 s the Commands group shows only `Echo B`.
- **AC15a – Claude Code in a shell:** Given a fixture transcript for session C at `<fake home>/.claude/projects/-some-other-folder/<C>.jsonl` with one command `Echo C` (description `Echo C`), when `board session . <C>` runs in the Default shell, then the Default shell's Agent tab shows `Echo C` in Commands within 3 s; the same for a temporary shell (New shell); after `board activity . working` there, Agents' `Main agent` reads `Running`; after the shell is closed and the Default shell started again, the tab reads `Run claude in this shell to see its agent here.`; `bikube-state.json` never holds `<C>`.
- **AC16 – Refused request:** Given the renderer asks main for a summary with session id `../../etc/passwd` or a relative folder, then main answers an error and reads no file (Vitest on the main handler's checks).
- **AC17 – Narrow and themed:** Given the side panel at 200 px with AC6's and AC10's fixtures, then the Agent tab body has no horizontal scroll, and its colours come from the app theme in Dark, Light and Nord.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – The tab and its messages:** `agent` in the side panel tabs and settings; the tab body choosing a message by what is in front (D2, D3's `No conversation yet` from a main request that only reports whether the transcript exists); the collapsible group shell (D6). Satisfies AC1, AC2, AC3.
2. **S2 – Reading the transcript, header and Commands:** the Node-free transcript parser into the agent summary (D7's model and todos, D10's commands with their status, duration, output tail and subagent tag, D11's caps), main's tailing reader and its IPC with D4's checks and D5's polling and drop, D12's error line; the header (model, the board card's context bar, todos) and the Commands group with its expanding rows, the command layout splitter and colouring, Copy. Satisfies AC4, AC5, AC6, AC7, AC13, AC14, AC15, AC16.
3. **S2a – Shells:** a running workspace shell's `board session .` and `board usage .` kept runtime only and cleared at its stop (D3a), main's lookup of a shell's transcript by session id, the tab following a shell's session with its folder, activity and usage. Satisfies AC2 (the shell message), AC15a.
4. **S3 – Agents:** subagents (with their transcripts' commands and tool counts) and background commands in the summary, the Agents group with its live durations and `N finished` row (D8). Satisfies AC8, AC9.
5. **S4 – What changed:** prompts, per-prompt file changes from edit tools and simple `rm`/`mv`/`git mv` commands, the merged badges and sizes, the view select, folder grouping, opening a file through `files:open` (D9). Satisfies AC10, AC11, AC12, AC17.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `e2e/agent-tab.spec.ts` | Board, side panel, click Agent; read the message; restart; still selected |
| AC2 | e2e | Open a plain card, the Default shell, an SSH card (fake `ssh`); read each message |
| AC3 | e2e | Open a Claude Code card with no fixture transcript |
| AC4 | e2e with fixture transcript; Vitest for todos parsing | Header text, bar label and tooltip, todo styles |
| AC5 | e2e appending to the fixture | Rows appear within 3 s |
| AC6 | Vitest on the parser (status, exit code, denial); e2e for rows | Row order and statuses |
| AC7 | Vitest on the command splitter (quotes, `$(…)`, heredoc); e2e for the expanded row and `recordClipboardWrites` | Click a row, read the lines, Copy |
| AC8 | Vitest on subagent parsing; e2e with a subagent fixture file | Agents and Commands rows, append the result |
| AC9 | Vitest; e2e | Agents row `Running`, Commands status `Background` |
| AC10 | Vitest on prompts and file changes (badges merged, sizes, `git mv`); e2e | What changed list, counts |
| AC11 | e2e | Switch the select |
| AC12 | e2e with fake `code` (`e2e/editors.ts` helpers) | Click the file, read the fake editor's log |
| AC13 | e2e | Collapse, open another card, restart |
| AC14 | e2e with a development-build request counter on main's `globalThis` | Switch tabs, the count stops |
| AC15 | e2e (`board session` typed in the card) | Commands switch to session B |
| AC15a | Vitest on the shell's `board session`/`usage` answer and on finding a transcript by session id; e2e in the Default and a temporary shell | Run `board session . <C>` in the shell, read Commands; restart the shell; read the state file |
| AC16 | Vitest on main's request checks | — |
| AC17 | e2e at 200 px, three themes; UX review | `scrollWidth <= clientWidth`, screenshots |

## Stack changes

None.

## Data and migrations

`sidePanelTab` accepts `agent`; existing settings files are unchanged. Nothing new in the state file or the Sync folder: the agent summary, the collapsed groups and a shell's session id and usage (D3a) are runtime only.

## Out of scope

- A split view or pane showing the agent monitor under the terminal (round 1 Q8: later, as its own item).
- Other agents (Codex, Gemini CLI, OpenCode, Pi), SSH cards and SSH workspaces' shells.
- Claude Code run in a card's extra pane as a separate conversation (its hooks report to the card, as today).
- Earlier sessions of the card, and a session picker.
- Whether a command was allowed automatically or approved by the user (no new hook).
- Showing code or diffs; git-based change detection; per-file AI summaries.
- Stopping a subagent or background command from the tab.

## Open questions

None.
