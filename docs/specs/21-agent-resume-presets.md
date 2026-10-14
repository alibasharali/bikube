---
item: 21
type: feature
title: Resume presets for other agents (Codex etc.)
status: approved
branch: claude/21-agent-resume-presets
---

# Resume presets for other agents (Codex etc.)

## Problem

Since #5 a card's startup command is `Shell`, `Claude Code` or `Custom`, and only Claude Code cards come back to their conversation without the user writing anything: a developer running Codex, Gemini CLI or OpenCode has to write and remember a Custom command such as `codex resume --last`, and a new card with that command resumes whatever old session happens to be latest in the directory instead of starting fresh. After this ships the startup command select also offers `Codex`, `Gemini CLI` and `OpenCode`: a new card starts the agent fresh, and every later start (reopening a Stopped card, after a restart) resumes that agent's latest session in the card's directory. Builds on #5 (startup commands, D3–D5), #8 (saved state), #12 (start line over SSH) and #13 (sync, D6), all merged.

None of these CLIs can start a session with an id Drovr chooses (Claude Code's `--session-id` is unique), and reading each agent's private session files to learn its id is fragile across versions and impossible for SSH cards, so these presets resume the agent's *latest session in the directory*, using only each CLI's public flags.

## Domain decisions

- **D1 – The presets:** three new startup commands, each with a plain command and a resume command typed as is (no arguments from the card):

  | Kind | Select label | Tag | Plain | Resume |
  |---|---|---|---|---|
  | `codex` | `Codex` | `Codex` | `codex` | `codex resume --last` |
  | `gemini` | `Gemini CLI` | `Gemini` | `gemini` | `gemini --resume latest` |
  | `opencode` | `OpenCode` | `OpenCode` | `opencode` | `opencode --continue` |

  Each resume command picks the agent's most recent session for the current directory (Codex filters `--last` by working directory; Gemini CLI and OpenCode keep sessions per project). The table is the one place these strings live (a core preset table), so another agent is one row later. *Why:* round 1 Q1 (Cursor Agent and Amp left for later); round 1 Q2.
- **D2 – Start line:** the first time a card starts a preset, Drovr types the plain command; every later start of the same preset on that card types `<resume> || <plain>`, so when there is nothing to resume (the first session never got a message, or its files were removed) the agent starts fresh and the card always comes back with the agent running. It is typed exactly like #5 D3 (followed by Enter, right after the spawn for local cards, after the ready marker for SSH cards, #12 D6). *Why:* round 1 Q2 (a new card never resumes an older conversation from outside Drovr), Q3 (same as Claude Code's fallback, #5 D5).
- **D3 – Started per preset:** a card records which presets it has started (`startedAgents`, a set of the D1 kinds, empty at creation). Typing a preset's first-start line adds its kind, at the same moment and under the same conditions as #5 D5 marks `claudeStarted` (for an SSH card, only once the line is actually typed after the marker, #12 D6). Switching a card's startup command never clears it, so switching from Codex to Shell and back resumes Codex. `claudeStarted` and Claude Code's behaviour are unchanged. *Why:* round 1 Q5.
- **D4 – Same directory, same session:** two cards with the same preset in the same directory resume the same (latest) session; Drovr accepts this and says so. While one of these presets is chosen, the `Startup command` field in the workspace dialogs and the card's `Startup command…` dialog shows the hint `Resumes the latest <label> session in the card's directory.` (e.g. `Resumes the latest Codex session in the card's directory.`). Claude Code cards are unaffected (they resume by their own id). *Why:* round 1 Q4: a limit of the agents' CLIs; refusing a second card would block legitimate setups.
- **D5 – Where they appear:** every startup command select (`+ New card`, workspace create and edit, card `Startup command…`) lists `Shell`, `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, `Custom…`, in that order; the workspace default (#5 D10) can be any of them. A card with a preset shows its tag (D1) on the board with tooltip = the select label, like `Claude` (#5 D12). The Custom field's placeholder `codex resume --last` changes to `npm run dev` (Codex has its own preset now). *Why:* round 1 Q7.
- **D6 – Saved state:** `startup` accepts the three new kinds; cards gain `startedAgents`, an array of distinct D1 kinds, optional when reading (missing means empty) and always written. A state file with an unknown kind in `startup` or `startedAgents`, or a non-array `startedAgents`, is invalid exactly as any other bad card is today (#8). Existing files stay valid with no migration. *Why:* round 1 Q5.
- **D7 – Sync:** `startedAgents` follows `claudeStarted` (#13 D6): a local card is written to the sync file with `startedAgents` empty and, when reading, keeps this machine's value if this machine has the card, else empty; an SSH card's `startedAgents` is synced as is. The sync file's version stays 1; a file without `startedAgents` reads as empty. *Why:* round 1 Q6: these agents keep sessions on the machine that ran them, so resuming on another machine would find nothing or the wrong session.
- **D8 – Security boundaries unchanged:** the start line still goes through `terminal:write` after `terminal:spawn`; no new IPC channel. The preset strings are constants; nothing from the card is interpolated into them. *Why:* AGENTS.md, #5 D14.

## Acceptance criteria

Workspace `alpha` has working directory `/tmp/drovr-alpha` (an existing directory), the default columns and default startup command `Shell`, unless stated otherwise. Fake `codex`, `gemini` and `opencode` on the login shell's `PATH` (like `e2e/fake-claude.ts`) each append `<name> <args>` as one line to one shared agent log, print `fake-<name> <args>`, and wait for a line on stdin before exiting 0; with `FAKE_AGENT_RESUME_FAILS=1`, a resume run (`codex resume …`, `gemini --resume …`, `opencode --continue`) exits 1 at once.

- **AC1 – Select and tags:** Given `alpha`'s board, when the user clicks `+ New card`, then the select lists `Shell`, `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, `Custom…` in that order; creating cards `cx`, `gm` and `oc` with `Codex`, `Gemini CLI` and `OpenCode` shows tags `Codex`, `Gemini` and `OpenCode` on the board, and the agent log gains exactly `codex`, `gemini` and `opencode` (no arguments), one line each.
- **AC2 – Resume on reopen:** Given card `cx` from AC1, when the user presses Enter (the fake quits), types `exit` (the card is `Stopped`) and opens `cx` again, then `codex resume --last || codex` was typed and the log's last line is `codex resume --last`. The same for `gm` (`gemini --resume latest`) and `oc` (`opencode --continue`).
- **AC3 – Nothing to resume:** Given `cx` Stopped after AC2 and `FAKE_AGENT_RESUME_FAILS=1`, when the user opens it, then the log's last two lines are `codex resume --last` and `codex`, and the fake codex is running.
- **AC4 – Switching keeps the flag:** Given running Shell card `sh`, when the user sets its `Startup command…` to `Codex`, stops and reopens it, then the log gains `codex`; when the user switches it to `Shell`, stops and reopens it (nothing typed), then switches back to `Codex`, stops and reopens it, then the log's last line is `codex resume --last`. A Claude Code card's behaviour (#5 AC2–AC5) is unchanged.
- **AC5 – Hint:** Given the card `Startup command…` dialog, when the user chooses `Gemini CLI`, then the dialog shows `Resumes the latest Gemini CLI session in the card's directory.`; choosing `Claude Code` or `Shell` shows no such hint. The workspace edit dialog shows the same hint for `OpenCode` (`Resumes the latest OpenCode session in the card's directory.`).
- **AC6 – Workspace default:** Given `alpha` edited to default `Codex`, then `+ New card` is preset to `Codex`, and existing cards keep their own startup commands.
- **AC7 – Survives a restart:** Given `cx` started once (AC1), when the app restarts and the user opens `cx`, then the log's last line is `codex resume --last`, and `drovr-state.json` has `cx` with `startup` `{ "kind": "codex" }` and `startedAgents` `["codex"]`. A state file written before this item (cards without `startedAgents`) loads with every card intact, and its Claude Code cards resume as before.
- **AC8 – Over SSH:** Given SSH workspace `remote` (fake `ssh` of #12, the fake agents on the fake remote's PATH) whose fake ssh waits 1 s before running the remote command (`FAKE_SSH_DELAY=1`), when the user creates Codex card `r`, then the log gains exactly one line `codex`, typed after the delay; after `exit` and reopening, its last line is `codex resume --last`.
- **AC9 – Sync:** Given two instances A and B sharing a Sync folder (#13), a local Codex card and an SSH Codex card that A has started, when B opens each, then the local card types `codex` and the SSH card types `codex resume --last || codex`.
- **AC10 – Checks:** `.claude/check.sh` and `xvfb-run -a npm run test:smoke` pass.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Presets end to end, local:** the core preset table (D1); the startup command type, `checkStartup` and the start line (D2) for the three kinds; `startedAgents` on cards (empty at creation) with a store operation marking a kind started, called where `claudeStarted` is marked today (D3); the selects, tags with tooltips, the D4 hint in `StartupField`, the placeholder (D5); saved-state reading and writing of the new kinds and `startedAgents` with missing = empty (D6). Unit tests (start lines, validation, store, saved-state validation, old files). Fake agents shared in a new e2e helper next to `e2e/fake-claude.ts`; smoke tests in `e2e/startup.spec.ts` or a new spec. Update `CONTEXT.md` (Startup command) and `AGENTS.md`'s smoke-test list. Satisfies AC1, AC2, AC3, AC4, AC5, AC6, AC7.
2. **S2 – SSH and sync:** the SSH card's first start marked only when the line is typed after the marker (D3, #12 D6) for the new kinds; the sync file writing local cards' `startedAgents` empty and the sync apply keeping this machine's values (D7), with missing = empty when reading. Unit tests on the sync mapping; smoke tests with the fake `ssh` and two instances. Satisfies AC8, AC9, AC10.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | unit (start line) + e2e | `+ New card` select options; create three cards; tags; agent log |
| AC2 | unit (start line) + e2e | Enter, `exit`, reopen each; agent log last line |
| AC3 | e2e | `FAKE_AGENT_RESUME_FAILS=1`; log last two lines |
| AC4 | unit (store) + e2e | Card menu `Startup command…`, switch away and back; log |
| AC5 | e2e | Card and workspace dialogs; hint text present or absent |
| AC6 | unit (store) + e2e | Edit workspace default; `+ New card` preset |
| AC7 | unit (saved state) + e2e | Restart; open `cx`; read `drovr-state.json`; load an old-format file |
| AC8 | e2e (fake `ssh`) | Delay; agent log one line; reopen |
| AC9 | unit (sync mapping) + e2e (two instances) | Open both cards on B; agent log |
| AC10 | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` | CI green |

The developer checks with the real Codex on macOS: create a Codex card, send a message, quit and `exit`, reopen the card, and see the same conversation.

## Stack changes

None.

## Data and migrations

- `StartupCommand` gains `{ kind: 'codex' } | { kind: 'gemini' } | { kind: 'opencode' }` (cards' `startup` and workspaces' `defaultStartup`).
- Cards gain `startedAgents: ('codex' | 'gemini' | 'opencode')[]`, distinct, empty at creation. In `drovr-state.json` and the sync file it is always written and optional when read (missing = `[]`), so existing files load unchanged; no version bump.

## Out of scope

- Resuming by the agent's own session id (reading agents' session files, hooks reporting ids).
- Keeping two same-preset cards in one directory on separate sessions (D4).
- Presets for Cursor Agent, Amp or other agents; extra arguments or flags per preset (a Custom command covers them).
- Detecting whether the agent is installed; a missing CLI shows the shell's own `command not found`, as for Claude Code.

## Open questions

None.
