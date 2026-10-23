---
item: 65
type: feature
title: PI agent
status: approved
branch: claude/65-pi-agent
---

# PI agent

## Problem

A developer who runs the Pi coding agent (pi.dev, `pi`, github.com/badlogic/pi-mono) has to start it as a Custom command, and a reopened card then starts a new Pi session instead of continuing the last one. After this ships `Pi` is a fourth agent resume preset beside Codex, Gemini CLI and OpenCode (#21): a new card starts `pi`, every later start continues Pi's latest session in the card's directory, and Pi cards get their own tag, logo and colour like the other agents. Builds on #21 (presets, D1–D8), #31/#41 (sidebar tree logos and `--kind` colours) and #64 (app themes' kind tokens), all merged.

## Domain decisions

- **D1 – The preset:** one new row in the core preset table (`AGENT_PRESETS`), kind `pi`:

  | Kind | Select label | Tag | Plain | Resume |
  |---|---|---|---|---|
  | `pi` | `Pi` | `Pi` | `pi` | `pi --continue` |

  `pi --continue` continues Pi's most recent session for the current directory, and starts a new one when there is none, so #21 D2's `<resume> || <plain>` line (`pi --continue || pi`) is typed unchanged; the `|| pi` only runs if `pi --continue` itself fails. Everything that derives from the table (installed-agents check, saved-state and sync validation, the startup selects and their same-directory hint `Resumes the latest Pi session in the card's directory.`, `startedAgents`) gets Pi with no code of its own. *Why:* round 1 Q1, Q2.
- **D2 – Order:** every startup command select lists `Shell`, `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, `Pi`, `Custom…` (`AGENT_KINDS` ends in `pi`). *Why:* round 1 Q3.
- **D3 – Logo:** Pi cards and shells show Pi's own pixel mark (pi-mono's `pi-logo.ts`, MIT) in the sidebar tree and the Shells tab, drawn as one SVG path in the card's `--kind` colour like the other agents' marks. The mark is a 4×4 grid of square pixels (rows top to bottom, `X` filled):

  ```
  X X X .
  X . X .
  X X . X
  X . . X
  ```

  in the 24-unit viewBox, 6 units per pixel, e.g. `M0 0h6v24H0zM6 0h12v6H6zM12 6h6v6h-6zM6 12h6v6H6zM18 12h6v12h-6z`. One colour (the brand's three colours are not used). Its licence (pi-mono, MIT, Mario Zechner) and source are added to `THIRD_PARTY_NOTICES`. *Why:* round 1 Q4.
- **D4 – Colour:** a new kind token `kind-pi`: `#eab65d` (Pi's yellow) under every dark version and a darker amber under every light version (e.g. `#a16207`), in `main.css`'s `:root` (dark and light) with a `[data-kind='pi']` rule, in `APP_THEME_TOKENS` and in the shared dark and light marks; a theme overrides it only where #64 D5's ratio (3:1 on `card` and `surface`) needs it, as Nord does for the others. `app-themes.test.ts` includes `kind-pi` in its kinds and marks. Its colour differs from every other kind's under each version. *Why:* round 1 Q5 (coral is too close to Claude's, blue to Gemini's).
- **D5 – No activity reporting:** Pi cards report no working / waiting / question activity and no usage, the same as Codex, Gemini CLI and OpenCode; nothing is installed into Pi. *Why:* round 1 Q6: a Pi extension would be a later item.
- **D6 – Sync compatibility:** a sync file holding a card with startup kind `pi` (or `pi` in `startedAgents`) reads as a bad card on a machine running a Bikube from before this item, as #21's kinds did; every machine sharing a Sync folder must be updated. No compatibility encoding. The README's and `CONTEXT.md`'s lists of presets name Pi. *Why:* round 1 Q7.
- **D7 – Unchanged:** #21 D2–D8 apply to Pi as to the other presets (first start plain, later resume, `startedAgents` per card, local cards' `startedAgents` kept per machine in sync, SSH cards typing it after the ready marker, no new IPC, constants only). An installed-agents check without `pi` on the login PATH shows `Pi (not installed)` disabled in local workspaces' selects, never for SSH (#21 / installed agents).

## Acceptance criteria

Workspace `alpha` has an existing working directory, default columns and default startup `Shell`, unless stated otherwise. The e2e fake agents (`e2e/fake-agents.ts`) gain a fake `pi` on the login PATH that appends `pi <args>` to the shared agent log, prints `fake-pi <args>` and waits on stdin; with `FAKE_AGENT_RESUME_FAILS=1` a resume run (`pi --continue`) exits 1 at once.

- **AC1 – Select and tag:** Given `alpha`'s board with the fake agents, when the user clicks `+ New card`, then the select lists `Shell`, `Claude Code`, `Codex`, `Gemini CLI`, `OpenCode`, `Pi`, `Custom…` in that order; creating card `pi card` with `Pi` shows tag `Pi` (tooltip `Pi`) on the board, and the agent log gains exactly the line `pi`.
- **AC2 – Resume:** Given `pi card` started once and stopped (Close), when it is opened again, then the agent log's next line is `pi --continue`; with `FAKE_AGENT_RESUME_FAILS=1` it is `pi --continue` followed by `pi`, and the card shows `fake-pi`.
- **AC3 – Hint and default:** Given the workspace edit dialog, when `Pi` is chosen as the startup command, then the field shows `Resumes the latest Pi session in the card's directory.`; saved, a new card's select is preset to `Pi`, and existing cards keep theirs.
- **AC4 – Saved:** Given a started `pi card`, when the app restarts and the card is opened, then the log's line is `pi --continue`, and `bikube-state.json` holds the card with `startup` kind `pi` and `startedAgents` `["pi"]`; a state file whose card has `startedAgents: ["pi"]` loads it.
- **AC5 – Not installed:** Given a login PATH with only the fake `claude` (no `pi`), when the new card select opens in a local workspace, then `Pi (not installed)` is disabled; in an SSH workspace `Pi` is enabled.
- **AC6 – Logo and colour:** Given running `Claude`, `Codex`, `Gemini CLI`, `OpenCode` and `Pi` cards, when the sidebar tree shows them, then the Pi card's row has `data-kind="pi"`, title `pi card (Pi)` and one `.agent-logo`, and its kind colour differs from the four other agents' and the Default shell's.
- **AC7 – Themes:** Given every app theme's dark and light version, then `kind-pi` holds 3:1 on `card` and `surface`, and `main.css` has exactly one `[data-kind='pi'] { --kind: var(--kind-pi); }` and Default's `kind-pi` values equal `main.css`'s (Vitest).
- **AC8 – Validation:** Given a state or sync file whose card has `startup` kind `pi`, then it reads as valid; with kind `pie` it is invalid as any bad card (Vitest).

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Pi preset:** the table row and order (D1, D2), the fake `pi` in `e2e/fake-agents.ts`, unit tests over the preset, start line, startup form, installed agents, saved state and sync (each test that lists every kind gains `pi`), e2e in `e2e/presets.spec.ts` for the select, tag, resume, hint, default, restart and not installed; README and `CONTEXT.md`. Satisfies AC1–AC5, AC8.
2. **S2 – Logo and colour:** the pixel mark in `AgentLogo` and its notice (D3), the `kind-pi` token in `main.css`, `app-themes.ts` and its test (D4), and the Pi card in `e2e/workspace-tree.spec.ts`'s logo test. Satisfies AC6, AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `presets.spec.ts`; Vitest startup-form | New card select order, tag `Pi`, agent log `pi` |
| AC2 | e2e `presets.spec.ts`; Vitest startup-command | Close and reopen, log `pi --continue` (and `pi` when it fails) |
| AC3 | e2e `presets.spec.ts` | Workspace edit dialog hint, new card preset |
| AC4 | e2e `presets.spec.ts`; Vitest saved-state | Restart, log line, state file contents |
| AC5 | e2e `presets.spec.ts`; Vitest installed-agents | Select with only fake `claude`; SSH workspace |
| AC6 | e2e `workspace-tree.spec.ts` | Sidebar tree row's kind, title, logo, distinct colour |
| AC7 | Vitest `app-themes.test.ts` | Settings > App theme, each theme light and dark: Pi tag readable |
| AC8 | Vitest saved-state, sync-file | — |

## Stack changes

None.

## Data and migrations

`startup.kind` and `startedAgents` accept `pi` in the state and sync files. No migration: existing files stay valid. Older Bikube versions read a Pi card in a shared sync file as invalid (D6).

## Out of scope

- Activity, waiting and usage reporting for Pi through a Pi extension (D5).
- Pi's interactive session picker (`pi -r`) or resuming a specific session id.
- A sync-compatibility encoding for older Bikube versions (D6).

## Open questions

None.
