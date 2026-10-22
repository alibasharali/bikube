---
item: 50
type: feature
title: 'Agent usage and cost per card'
status: approved
branch: claude/50-agent-usage-cost
---

# Agent usage and cost per card

## Problem

Running many Claude Code agents side by side makes it easy to burn through limits without noticing: nothing on the board says how much each card's conversation has used. After this ships, every local Claude Code card shows, under its status lines, its conversation's estimated cost and current context (`≈$1.24 · 84k ctx`, the token breakdown in a tooltip; now its context bar only, see the note below), and the title bar shows the workspace's total while its board is shown. Drovr's Claude hooks report it with a new `board usage` subcommand, whose local CLI reads Claude Code's session transcript (as `ccusage` does). Runtime only: never saved or synced. *Polish round 3 removed the cost estimate (D4) and the workspace total (D9): cards show their context and tokens only.*

## Domain decisions

- **D1 – Source:** a conversation's usage is read from Claude Code's session transcript, the JSONL file named by `transcript_path` in a hook's input. Not Claude Code's `statusLine` JSON: a status line in Drovr's settings file would replace the user's own. *Why:* full auto chose it: the hooks are already wired (#31 D14), and the transcript holds every message's usage and persists, so a resumed card shows its whole conversation at once.
- **D2 – Reading a transcript:** done by the local `board` CLI (Node), never by main or the renderer. Every line is parsed as JSON on its own; a line that isn't JSON, or isn't an assistant entry with a `message.usage` object, is skipped. Counted per entry: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` (missing ones, and any that isn't a non-negative safe integer, are 0; a `message.model` longer than 200 characters is cut to 200), so a well-formed report always passes main's check (D5). Claude Code writes one message several times while it streams: entries with the same `message.id` and `requestId` count once (the last one read), entries lacking both count each. Entries whose four counts are all 0 (e.g. the `<synthetic>` model) are skipped. Subagents: every `*.jsonl` file under the folder `<transcript folder>/<session id>/subagents/` (the transcript's file name without `.jsonl`), when it exists, is read the same way and added; a missing folder is not an error. The file is read line by line (streamed), so a large transcript never loads whole.
- **D3 – A card's usage:** the four token totals above; **tokens**, their sum; **context**, the latest entry (in file order) of the transcript itself (not subagents) whose `isSidechain` isn't `true`: its `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; **model**, that same entry's `message.model`; **cost**, the estimated cost in USD (D4), or none. *Superseded by polish round 3:* no cost: a card's usage is the token totals, context and model only.
- **D4 – Estimated cost:** the sum over counted entries of each entry's tokens at its model's price, from a built-in table in `src/core` (USD per million tokens; cache writes at 1.25× input, cache reads at 0.1× input): *Superseded by polish round 3:* removed. Drovr estimates no cost anywhere; the price table is gone.

  | `message.model` starts with | input | output |
  |---|---|---|
  | `claude-opus-4-5`, `claude-opus-4-6` … `claude-opus-4-9`, `claude-opus-5` and later `claude-opus-<n>` (n ≥ 5) | 5 | 25 |
  | `claude-opus-4` (other), `claude-3-opus` | 15 | 75 |
  | `claude-sonnet-`, `claude-3-7-sonnet`, `claude-3-5-sonnet` | 3 | 15 |
  | `claude-haiku-4-5`, `claude-haiku-<n>` (n ≥ 5) | 1 | 5 |
  | `claude-3-5-haiku` | 0.8 | 4 |

  An entry whose model matches no row leaves the whole cost unknown (none), while tokens and context still count. It is an API-price estimate, also for subscription users, always shown with `≈`. *Why:* full auto chose cost as the familiar proxy for burning limits (ccusage, Claude Code's `/cost`); a wrong guess for an unknown model is worse than none.
- **D5 – `board usage <card> <transcript>`:** reads the transcript (D2), then sends the usage (D3) for the card as one request. Not in `board help` (like `board setup`, #39), since only Drovr's hooks run it. A transcript that can't be read prints `board: can't read <path>` and exits 1, sending nothing; a readable transcript with nothing counted sends zero usage, which clears the card's usage (D7), so `/clear` starts the card from nothing. Main checks the request like every other (version, exact keys) and the usage's shape: the four counts, tokens and context non-negative safe integers, cost a non-negative finite number or absent, model a string of at most 200 characters; anything else is `board: invalid request`. Like every `board` command it works only from a card with a running shell. Local cards only: an SSH card's remote `board` script doesn't know `usage` (it prints its usage text and exits 2, discarded by the hook), so SSH cards show no usage. *Why:* full auto left SSH out: the remote client is a fixed-shape embedded perl or python3 script. *Superseded by polish round 3:* the usage has exactly the six counts and the model; a request with a `cost` key is `board: invalid request`.
- **D6 – When it is reported:** Drovr's Claude settings file (#31 D14) gains, for `Stop` and for `SessionStart` (every source: startup, resume, clear, compact), one more command that cuts `transcript_path` out of the hook's input with plain sh parameter expansion (no backslash, as `REPORT_SESSION` does for `session_id`) and runs `"$DROVR_BIN/board" usage . "<path>"` in the background with every stream detached, exit 0 whatever happens, so Claude never waits on it. At `SessionStart` a transcript that doesn't exist yet (after `/clear` Claude Code creates the new file only with its first entry) is reported as `/dev/null`, which reads as zero usage and clears the card (D5); at `Stop` the path is passed as is. Nothing on `PreToolUse`. *Why:* full auto chose per turn: reading a large transcript on every tool call is wasteful.
- **D7 – Kept until:** a card's usage is runtime state in the renderer, replaced by each report for it, kept when its process stops or starts (it is the conversation's total, still true after a stop), and gone when the card is deleted, when a zero report arrives (D5), or when the app quits. Never in `drovr-state.json`, the Sync folder or kept output. *Why:* full auto chose to keep it across a stop; the item says runtime only, not synced.
- **D8 – On the board card:** a card with usage whose tokens are above 0 shows one dim line, the last of its lines (after the agent status and the last output line), whether running or not: `≈$<cost> · <context> ctx`, or `<tokens> tokens · <context> ctx` when the cost is unknown. Cost: two decimals (`≈$1.24`), `<$0.01` below a cent, thousands grouped (`≈$1,204.50`). Token counts: below 1,000 as is (`840`); below 1,000,000 in rounded thousands (`84k`; 999,500 and up reads `1.0M`); else millions with one decimal (`1.2M`). Its tooltip: `Claude Code usage (estimate)` then lines `Input <n>`, `Output <n>`, `Cache write <n>`, `Cache read <n>`, `Context <n>`, `Model <model>` with full grouped numbers (`12,345`). No setting hides it. *Why:* full auto chose cost and context, no setting. *Superseded by polish round 3:* the card shows its context bar (`42% context`), its tooltip the context, the token breakdown and the model; never a cost.
- **D9 – Workspace total:** while a workspace's board is shown (no card or shell open), the title bar shows, after the workspace's name, a small chip with the sum over its cards with usage: `≈$<sum of the known costs>` when at least one card has a cost, else `<sum of tokens> tokens`; its tooltip `Claude Code usage of this workspace's cards (estimate)` then `Cards <n>`, `Tokens <n>` and, when some card's cost is unknown, `Some cards' cost unknown`. Hidden when no card of the workspace has usage. No per-day or app-wide total. *Why:* full auto chose a workspace total only: a daily total needs dates kept across restarts, which runtime-only rules out. *Superseded by polish round 3:* removed. The title bar shows no workspace total.
- **D10 – Nothing else changes:** the activity, agent status, `board session`, notifications and the other hooks behave as before.

## Acceptance criteria

- **AC1 – Card line:** Given a running local plain card and a transcript file `t.jsonl` with two assistant entries, model `claude-sonnet-4-5`: the first `{input 1000, output 500, cache write 2000, cache read 0}`, the second `{input 10, output 200, cache write 0, cache read 3000}`, when the card runs `board usage . t.jsonl`, then the board card shows `≈$0.02 · 3k ctx` (cost 0.003+0.0075+0.0075+0.00003+0.003+0.0009 = $0.02193) and its tooltip reads `Input 1,010`, `Output 700`, `Cache write 2,000`, `Cache read 3,000`, `Context 3,010`, `Model claude-sonnet-4-5`. *Superseded by polish round 3:* the card reads `2% context`, with no cost.
- **AC2 – Streamed duplicates and subagents:** Given a transcript where the same `message.id` and `requestId` appear three times and a `subagents/agent-1.jsonl` beside it with one `claude-haiku-4-5` entry, then the first counts once and the subagent's tokens are added to the totals but not to the context (unit level, Vitest on fixture files).
- **AC3 – Unknown model:** Given a transcript with one entry of model `gpt-x` (`input 1000, output 1000`), when reported, then the card shows `2k tokens · 1k ctx` and the tooltip has no cost. *Superseded by polish round 3:* no cost to be unknown.
- **AC4 – Replace, keep, clear:** Given AC1's line, when the card runs `board usage .` with a transcript of one `claude-opus-4-5` entry `{input 0, output 1,000,000, cache 0, 0}`, then it shows `≈$25.00 · 0 ctx`; when the card is Closed, the line stays; when it runs `board usage .` on an empty file, the line is gone; when a card with usage is deleted and another created with the same title, it has none. *Superseded by polish round 3:* the card shows its context bar, never a cost; the rest (Close keeps it, an empty transcript clears it, delete forgets it) still holds.
- **AC5 – Errors:** Given a running card, when it runs `board usage . /nope.jsonl`, then it prints `board: can't read /nope.jsonl` and exits 1, and `board usage .` alone prints the usage text and exits 2; `board help` doesn't list `usage`; a hand-written request with a negative or fractional token count is answered `board: invalid request` (unit level).
- **AC6 – Hooks:** Given the Claude settings file, when its `Stop` and `SessionStart` commands run under `sh` with input `{"session_id":"…","transcript_path":"/tmp/x y/t.jsonl",…}` and a fake `board` on `$DROVR_BIN` that logs its arguments, then the fake logs `usage . /tmp/x y/t.jsonl` (and SessionStart still prints the instruction); `resources/bin/claude-settings.json` equals the generated text; neither command has a backslash.
- **AC7 – Workspace total:** Given workspace `Alpha` with cards A (`≈$0.02`) and B (`≈$25.00`) and a card C without usage, when its board shows, then the title bar shows `≈$25.02` with tooltip `Cards 2`; when a card is open the chip isn't shown; a workspace with no usage shows no chip. *Superseded by polish round 3:* removed with D9; `e2e/usage.spec.ts` checks the title bar shows no `$`.
- **AC8 – Not saved:** Given AC1's line, when the app restarts, then the card shows no usage, and `drovr-state.json` has no usage key.
- **AC9 – SSH:** Given an SSH card (fake `ssh`), `board usage . t.jsonl` exits 2 with the remote usage text and the card shows no usage line.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Reading and pricing:** the transcript reader (D2, D3) and price table with cost (D4) in `src/core` (plain Node streams, fs injected or real temp files), and the formatting of the card line, tooltip and total (D8, D9) as pure functions. Satisfies AC2 and the numbers of AC1, AC3, AC4 at unit level.
2. **S2 – `board usage` end to end:** the subcommand in the CLI's argument parsing (hidden from help) and client (reads the transcript, D5), the protocol's `usage` command and its validation, main forwarding it like the others, the renderer's usage map (D7) with a subscription, cleared on delete, and the card line (D8). The remote client's argument check stays as it is. Satisfies AC1, AC3, AC4, AC5, AC8, AC9.
3. **S3 – Hooks:** the `Stop` and `SessionStart` commands (D6) in the generated Claude settings, `resources/bin/claude-settings.json` regenerated, and a unit test running them under `sh` with a fake board. Satisfies AC6.
4. **S4 – Workspace total and docs:** the title bar chip (D9); CONTEXT.md gains a **Usage** entry and the Board command entry mentions `board usage`; AGENTS.md's smoke-test list names the new e2e file and the architecture section notes `board usage` in the `board` paragraph. Satisfies AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC3, AC4 | Vitest (reader, pricing, formatting) + e2e `e2e/usage.spec.ts` | Write fixture transcripts in the test's temp dir, type `board usage . <file>` in a plain card, read the board card's usage line and its `title` |
| AC2 | Vitest on fixture files | — |
| AC5 | Vitest (args, protocol) + e2e | Type the commands in a card, read the terminal |
| AC6 | Vitest (`claude-hooks.test.ts`, running the commands with `sh`) | — |
| AC7 | e2e | Two cards reported, read the title bar chip, open a card |
| AC8 | e2e | Restart through `launch.ts`, read the card and the state file |
| AC9 | e2e (`fake-ssh.ts`) | Type it in an SSH card |

## Stack changes

None.

## Data and migrations

None: usage is runtime only. The Claude settings file (`resources/bin/claude-settings.json` and the SSH copy) gains two hook commands.

## Out of scope

- SSH cards' usage (D5).
- Codex, Gemini CLI and OpenCode cards.
- A per-day or app-wide total, history, or limits and warnings.
- Claude Code's `statusLine`, and live updates between turns.
- Keeping usage across restarts or syncing it.
- A setting to hide it.

## Open questions

None.

## Decided by full auto

Round 1: usage read from the session transcript by the local `board` CLI (`board usage . <transcript>`); the card shows estimated cost and current context with a token breakdown tooltip; reported at Stop and SessionStart in the background; kept across a stop until the app quits, the card is deleted or a new report replaces it; a workspace total chip in the title bar, no per-day total; SSH cards out of scope; no setting.
