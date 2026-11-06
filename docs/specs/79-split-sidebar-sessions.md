---
item: 79
type: feature
title: Split Workspaces and Agents/sessions option
status: draft
branch: claude/79-split-workspaces-sessions
---

# Split Workspaces and Agents/sessions option

## Problem

Today the sidebar is one tree: each workspace row with its running cards and shells nested under it. With many workspaces and agents, a developer has to scan every workspace to see which agents are working or need them. After this ships, a Settings option (and a palette row) switches the sidebar to **Split**: workspaces on top, and below them one **Agents** section listing every workspace's running agents, grouped by Needs you, Working and Idle, each with its workspace and how long it has been in that state (like Herdr, [image 1] of the item). Nested, today's tree, stays the default.

Note: `docs/specs/79-agent-tab-files-artifacts.md` belongs to an earlier, shipped item that also had the number 79; this spec is a different item.

## Domain decisions

- **D1 – The setting:** a preference `sidebarLayout`, `'nested'` (default) or `'split'`, in the Preferences table of the settings module (defaults and checks), written to `bikube-settings.json` only when `split`; an unknown value is dropped like any bad preference. Settings > Appearance gets a **Sidebar layout** radio pair, Nested and Split, applied at once. The command palette lists the other layout as an action row, `Sidebar: Split` while Nested, `Sidebar: Nested` while Split, beside the View rows; Enter saves it as the radio does. *Why:* developer's choice (Q1), a Settings row plus a palette row, no sidebar button.
- **D2 – What counts as an agent:** a running card or shell (an `OpenTerminal` row) is an **agent row** when any of these holds:
  1. it is a card whose startup command is an agent: Claude Code or an agent preset (Codex, Gemini CLI, OpenCode, Pi);
  2. Claude Code runs in its main pane now, by #58's signal (its probe seen, or `claude` in the foreground, with focus reporting on);
  3. it has an activity set (`working`, `waiting` or `question`, from `board activity`, which Claude Code's hooks send).

  Every other running card or shell (plain cards, custom commands, the Default shell, named shells, triggers once opened, temporary shells) is a **plain terminal**. A plain terminal becomes an agent row as soon as 2 or 3 holds and goes back once neither does (so a shell where Claude Code exited stays an agent row while its `Waiting for you` lasts, until it is looked at). *Why:* developer's answer to Q5: terminals stay nested, "but if a terminal is running claude code/agent, it should move to the agents section". Agents other than Claude Code typed by hand in a shell can't be detected (they send no hooks and no probe) and stay plain.
- **D3 – Split layout, expanded:** the sidebar shows, under its header, a **Workspaces** section (the workspace rows, in sidebar order, each with its plain terminals and its Agent setup row nested under it exactly as today) at its natural height, scrolling once it passes half the sidebar's height; then a divider with the heading **Agents**, and the Agents section filling the rest of the height above the footer, scrolling on its own. Workspace drag and Alt+Up/Down moves work as today within the Workspaces section. *Why:* Q4, Q5.
- **D4 – Agents section groups:** agent rows are grouped under headings, in this order: **Needs you** (activity `waiting` or `question`), **Working** (activity `working`), **Idle** (no activity). Each heading shows its count (`Working 1`); a group with no rows is not shown. Within a group rows keep the Nested order (workspaces in sidebar order, then each workspace's own order: cards in column order, then shells, Default shell first), so rows don't jump inside a group. With no agent rows at all the section shows the heading and one muted line, `No agents running.` *Why:* Q2.
- **D5 – Agent row:** today's terminal row (its tool's logo or held number, title, In window icon, status mark, `--kind` colour, needs-you style, current marking, click opening it as today), plus under or beside the title the workspace's name in muted text and, at the row's end before the status mark, the time it has been in its current group: `now` under a minute, then `4m`, `2h`, `3d` (whole units, rounded down). The tooltip is `<title> (<tool>) · <workspace>`. *Why:* Q3.
- **D6 – Status time:** the renderer stamps, for each running card or shell, the time its group (Needs you, Working, Idle) last changed, and its start counts as a change; runtime only, never saved or synced, forgotten when it stops. The shown times are redrawn at least every 30 s. A plain terminal turning into an agent row keeps its stamp (it reads from its last group change). *Why:* Q3's "time since its last status change"; a runtime stamp needs no data change.
- **D7 – Collapsed Split sidebar:** the workspace badges as today, then a divider, then one icon button per agent row in D4's order (no group headings): its tool's logo with its status mark over the logo's corner, the tooltip `<title> · <workspace> · <status label>`, a click opening it, the current one marked, the needs-you style kept. Plain terminals show nothing collapsed, as today. *Why:* Q6.
- **D8 – Waiting dot in Split:** in Split, a workspace badge shows its waiting-count dot (`waitingCounts`, as the collapsed sidebar does today) expanded too, since its agents are no longer under it. Nested keeps today's behaviour (dot only collapsed). *Why:* Q7.
- **D9 – Held numbers:** Ctrl+digit (Alt+digit off macOS) still picks the active workspace's Nth terminal in today's Nested order, unchanged. While the modifier is held, each of the active workspace's rows shows its digit wherever it sits: nested under the workspace row or in the Agents section (and on its collapsed icon). Mod+digit on workspace rows is unchanged. *Why:* Q8.
- **D10 – Nested unchanged:** with `sidebarLayout` Nested (or absent) the sidebar renders exactly as before this item, and the existing sidebar tests pass unchanged.

## Acceptance criteria

- **AC1 – Setting and palette:** Given default settings, when Settings > Appearance opens, then a **Sidebar layout** group shows Nested checked and Split unchecked, and `bikube-settings.json` has no `sidebarLayout` key. When Split is clicked, then the sidebar shows the Agents section at once and the file holds `"sidebarLayout": "split"`; after a restart the sidebar is still Split. When the palette opens, then it lists `Sidebar: Nested` and not `Sidebar: Split`; Enter on it brings back the tree and removes the key from the file.
- **AC2 – Bad value:** Given `bikube-settings.json` with `"sidebarLayout": "sideways"`, when the app starts, then the sidebar is Nested and Settings shows Nested checked.
- **AC3 – Split sections:** Given Split, workspace A with a running Claude Code card `Fix` (fake `claude`) and a running plain card `Logs`, and workspace B with a running Codex card `Port` (fake `codex`), when the sidebar shows, then the Workspaces section lists A and B, `Logs` nested under A and nothing under B; the Agents section lists `Fix` (with `A`) and `Port` (with `B`), and neither is nested under its workspace.
- **AC4 – Groups:** Given AC3's cards, when `board activity . working` runs in `Fix` and `board activity . question` in `Port`, then the Agents section shows `Needs you 1` with `Port`, then `Working 1` with `Fix`, and no Idle heading; when `board activity . none` runs in `Port`, then `Working 1` with `Fix` then `Idle 1` with `Port`.
- **AC5 – A plain terminal running Claude Code:** Given Split and the Default shell of A running, when Claude Code's probe (OSC 7501) is printed and focus reporting turned on in it (the fake `claude` started from the shell), then its row leaves A's nested rows and shows in the Agents section's Idle group with `A`; when focus reporting is turned off and its activity is none, then it is nested under A again. A plain card where `board activity . working` runs shows in Working.
- **AC6 – Status time:** Given Split and an agent row that entered Working, when 3 minutes pass (the renderer's clock advanced in the test), then its time reads `3m`; when its activity changes to `waiting`, then it reads `now` in Needs you. Unit: `0 → now`, `59 s → now`, `4 min 59 s → 4m`, `2 h 10 min → 2h`, `3 d 5 h → 3d`.
- **AC7 – Empty Agents:** Given Split and no running agent, then the Agents heading shows with `No agents running.` and no group headings.
- **AC8 – Open and current:** Given AC3, when `Port` is clicked in the Agents section, then B becomes active and `Port` opens at full size, and its row is marked current (`aria-current="true"`); the Agent setup row of a workspace with that page open stays nested under its workspace.
- **AC9 – Waiting dot expanded:** Given Split and `Fix` waiting (`board activity . waiting`) while A is not in view, then A's expanded badge shows the dot with count 1; in Nested the expanded badge shows none.
- **AC10 – Collapsed Split:** Given Split with AC4's first state and the sidebar collapsed, then after the badges a divider and two icons show, `Port` first, each with its status mark and the tooltip `Port · B · Needs your answer`; a click on `Fix` opens it. In Nested collapsed, no icons show.
- **AC11 – Held numbers:** Given Split, A active with running `Fix` (agent) then `Logs` (plain) in column order, when Ctrl (Alt off macOS) is held, then `Fix` shows `1` in the Agents section and `Logs` shows `2` nested under A, and Ctrl+2 opens `Logs`.
- **AC12 – Layout and themes:** Given Split with 12 workspaces and 8 agent rows in a 720 px high window, then the Workspaces section scrolls, no taller than half the sidebar, and the Agents section scrolls on its own; at the minimum window width no row scrolls sideways, and the headings, muted workspace names and times use theme tokens in Dark, Light and Nord.
- **AC13 – Nested unchanged:** Given Nested, then the existing sidebar tree tests (`e2e/workspace-tree.spec.ts`) pass unchanged and no Agents heading exists.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Setting, Split layout and groups:** the `sidebarLayout` preference and its check, Settings > Appearance's radio pair, the palette rows; a Node-free core module that takes the open terminals, which of them are agent rows, and the active workspace, and returns the Workspaces section's nested rows, the Agents section's groups in D4's order, and each active-workspace row's held number; D2's rules 1 and 3; the Sidebar rendering D3, D4, D5 (without the time), D8, D9 and the empty line. Satisfies AC1, AC2, AC3, AC4, AC7, AC8, AC9, AC11, AC13.
2. **S2 – Claude Code in a plain terminal:** card terminals expose, per card or shell, whether Claude Code runs in its main pane now (#58's signal) with change notifications, and the sidebar's open-terminals hook follows it for D2's rule 2. Satisfies AC5.
3. **S3 – Status time:** the runtime group-change stamps (D6), the compact age formatter in core, the time on agent rows redrawn every 30 s. Satisfies AC6.
4. **S4 – Collapsed Split and layout polish:** D7's icons after a divider, D3's height split and scrolling checked at narrow and short windows in every theme. Satisfies AC10, AC12.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest (preference default and check, palette rows) + e2e `e2e/sidebar-split.spec.ts` | Settings > Appearance, click Split, read `bikube-settings.json`, restart; palette `Sidebar: Nested` |
| AC2 | Vitest (settings check) + e2e (written settings file) | Start with the bad value; sidebar Nested |
| AC3 | Vitest (sections module) + e2e with `fakeAgentsHome` (fake `claude`, `codex`) | Two workspaces, three cards; read both sections |
| AC4 | Vitest (grouping order) + e2e (`board activity` typed in cards) | Headings and counts follow the activities |
| AC5 | e2e (probe and `CSI ? 1004 h/l` printed with `printf` in the Default shell, fake `claude` as foreground) | Row moves into Agents and back |
| AC6 | Vitest (age formatter, stamps) + e2e with the page clock advanced (`page.clock`) | `3m`, then `now` after a change |
| AC7 | e2e | Split with nothing running |
| AC8 | e2e | Click an agent row in another workspace |
| AC9 | e2e (`board activity . waiting` from a sibling card while A isn't shown) | Dot on A's badge expanded in Split only |
| AC10 | e2e | Collapse the sidebar in Split and Nested |
| AC11 | Vitest (numbers) + e2e (held modifier as in `e2e/workspace-tree.spec.ts`) | Digits on both sections; Ctrl+2 |
| AC12 | e2e (bounding boxes, computed colours against tokens in Dark, Light, Nord) + UX review | 12 workspaces, 8 agents, 720 px; 320 px wide |
| AC13 | existing `e2e/workspace-tree.spec.ts` | Nested looks as before |

## Stack changes

None.

## Data and migrations

One new preference, `sidebarLayout` in `bikube-settings.json`, written only when `split`; files without it read Nested. Status-change stamps are runtime only. Nothing in `bikube-state.json` or the Sync folder changes.

## Out of scope

- A sidebar button to switch layouts, or a resizable divider between the sections (Q1, Q4).
- Detecting agents other than Claude Code typed by hand in a plain shell or card (no signal; D2).
- Changing what Ctrl+digit picks (D9), or ordering agents by recency.
- Showing extra panes' agents separately: a card or shell is one row whatever its panes run (its activity covers every pane; rule 2 reads the main pane).
- Card windows' own sidebar (they have none).

## Open questions

None.
