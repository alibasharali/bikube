---
item: 71
type: feature
title: Tidier Agent setup page
status: approved
branch: claude/71-tidy-agent-setup
---

# Tidier Agent setup page

## Problem

On the Agent setup page (#68), long sections (Skills, Hooks, Config) need scrolling to see everything: a user with many User skills has to scroll past them to reach the Project ones, and every hook event's list is always open. After this ships, a page-wide **source filter** (All · Project · Local · User · Bikube · Plugin ▾) narrows every section to one source, Overview's per-source split links straight to a filtered section, and the groups a section already has (Hooks' events, Permissions' lists, Config's Settings and Preferences, Plugins' Installed and Marketplaces) fold away under headings that show their counts. Rows keep their full descriptions (the developer chose no denser rows).

Related: #68 (the page this changes), #70 (merged; its `FileActions` and open errors in the section views are left as they are).

## Domain decisions

- **D1 – One source filter for the page:** the filter is one value per workspace's page, not per section: `All` (default), `Project`, `Local`, `User`, `Bikube`, `All plugins`, or one plugin (by its key, `Plugin <name>`). Picking `User` in Skills and then showing Hooks shows only User hooks. It combines with the search (D25): a row shows when it matches both. *Why:* the developer picked one page-wide choice over per-section memory (round 1, Q4); it follows the search's model, which is page-wide too.
- **D2 – What a row's source is:** a row matches the filter by the source its chip reads (#68 D9): skills, agents, commands, hooks, memory files, permission rules, MCP servers and Config's Settings rows by their entry's source; Config's Preferences are `User`; an installed plugin by its install's scope (`pluginSource`), and in addition a plugin row matches `All plugins` and its own plugin's filter, so following a plugin's filter to Plugins shows that plugin. Marketplaces have no source: their group shows only under `All`. Permissions' Default mode line is never filtered (as it is never searched). A memory file is kept when it matches, with all its imports, or when one of its imports matches, with only those (as the search does). Rows past a folder's limit (D11's `… N more`) are counted and shown only with no search and the filter at `All`. Status and Stats are never filtered.
- **D3 – Where the filter shows:** a row of chips at the top of each filterable section's panel, under its title (Overview, Plugins, MCP servers, Skills, Agents, Commands, Hooks, Memory, Permissions, Config): `All`, then the sources with at least one row in that section (search not applied, so chips don't come and go while typing), in the order Project · Local · User · Bikube · Plugin. Each chip shows the count of the section's rows from that source that match the search; `All` shows the section's total matching the search. A section whose rows all come from one source shows no chip row, unless the filter isn't `All`: then the row shows, with the active chip present (count 0 if it has no rows here), so the filter can always be seen and set back to `All`. Overview's chips are the sources across its cards' sections. *Why:* round 1, Q3 (only sources with rows; one source, no filter); the exception keeps an active filter from ever being invisible.
- **D4 – The Plugin chip:** one `Plugin` chip, shown when the section has a row from any plugin (or the filter is a plugin), opens a menu: `All plugins`, then each plugin with rows in this section, by name, each with its count (as D3's). The chip reads `Plugin` for `All plugins` and `Plugin <name>` for one plugin; a filter naming a plugin no longer in the snapshot reads its key and matches nothing. The menu is the app's existing menu button pattern (Up/Down, Enter, Esc closes and gives focus back to the chip). *Why:* round 1, Q2; one chip keeps the row short however many plugins are installed.
- **D5 – The chips' controls:** each source chip is a toggle button with `aria-pressed`, the whole row a labelled group (`Filter by source`); clicking the active chip other than `All` sets `All`. The row wraps on a narrow page, never scrolling sideways (320 px, #68's strip test). The active chip uses the accent tokens of the app theme (#64), so it reads in every theme and version.
- **D6 – Counts and dimming follow the filter:** the section list's counts, Overview's card counts and splits, and the dimming of sections and cards with no rows (#68 D25) follow the filter as they follow the search: a section is dimmed while the search is non-empty or the filter isn't `All`, and it has no matching row. An empty filtered section reads `No <noun> from <chip label>` (with a search too: `No <noun> from <chip label> match “<query>”`). *Why:* round 1, Q4.
- **D7 – Overview's split links:** each part of a card's split (`3 Project · 8 User`) is its own button: a click shows that section with the filter set to that source (`Plugin` sets `All plugins`); a click elsewhere on the card shows the section as today, the filter unchanged. *Why:* round 1, Q7.
- **D8 – A plugin's provides-counts set the filter:** in Plugins, a provides-count (`2 skills`, #68 D15) shows its section with the filter set to that plugin, instead of putting `Plugin <name>` in the search; the search is left as it is. *Why:* the filter now says exactly this; a search for `Plugin kit` also hit any description naming it. This replaces #68 S4's behaviour and its e2e assertion.
- **D9 – Collapsible group headings:** the groups of Hooks (each event), Permissions (Allow, Ask, Deny, Additional directories), Config (Settings, Preferences) and Plugins (Installed, Marketplaces) get a heading button with a chevron, its name and the count of its rows shown (search and filter applied), `aria-expanded` and `aria-controls` its rows. Every group starts open; a collapsed one stays collapsed across reads, sections, searches and filters, kept per workspace for the run of the app (never saved), keyed by section and group name (a hook event by its name). A group with no row shown under the search or filter is hidden (Hooks today) or reads its empty line (the others, as today). Skills, Agents, Commands, MCP servers and Memory get no new grouping. Sandbox (#72, merged before this) follows D2 and D9 as #72's spec asks: its lists' entries match by their file's source (its facts are never filtered, as Default mode isn't), and its list headings collapse like Permissions' groups. *Why:* round 1, Q1 and Q6; a hook event that comes back after a read keeps its state because it is keyed by name.
- **D10 – Page memory:** the filter and the collapsed groups join the section and query in the page's per-workspace memory (#68 D7, runtime only): kept across Back, workspace switches and reopening the page in the run, gone after a restart. Esc in the search clears only the query.

## Acceptance criteria

Fixtures are a fake home (`BIKUBE_HOME_DIR`) as in `e2e/agent-setup.spec.ts`, extended where it lacks these: 2 Project skills, 3 User skills and 1 skill of plugin `kit`, hooks under at least `PreToolUse` and `SessionStart` with Bikube's own and a User one, Config keys from Local and User files and at least one Preference.

- **AC1 – Chips per section:** Given that workspace, when Skills shows, then its chip row reads `All 6`, `Project 2`, `User 3`, `Plugin 1`, with `All` pressed; and given a section whose rows all come from one source (e.g. a workspace with only User agents) with the filter at `All`, when Agents shows, then it has no chip row.
- **AC2 – Filtering a section:** Given Skills, when `User` is clicked, then only the 3 User skills show, `User` is pressed, the section list's Skills count reads 3; when `User` is clicked again, all 6 show and `All` is pressed.
- **AC3 – Page-wide:** Given the filter at `User`, when Hooks shows, then only User hooks show (no Bikube hook), its chip row shows `User` pressed; and when Status shows, its rows are all there; and the section list dims every section with no User row (e.g. one with only Project rows).
- **AC4 – Filter and search together:** Given the filter at `User` and the search `bl`, then Skills shows only User skills matching `bl`, each chip's count is its source's rows matching `bl`; when the search has no match, it reads `No skills from User match “bl”`; Esc in the search clears the query and the filter stays `User`.
- **AC5 – Active filter with no rows here:** Given the filter at `Project`, when a section with only User rows shows (e.g. Memory with only `~/.claude/CLAUDE.md`), then the chip row shows `All` and `Project 0` pressed and the section reads `No memory files from Project`; clicking `All` shows its rows.
- **AC6 – The Plugin chip:** Given Skills, when `Plugin` is clicked, then a menu lists `All plugins 1` and `kit 1`; Down then Enter on `kit` closes the menu, the chip reads `Plugin kit` pressed, and only kit's skill shows; Esc on the open menu closes it with focus on the chip.
- **AC7 – Plugins under a plugin filter:** Given the filter at `Plugin kit`, when Plugins shows, then the `kit` plugin row shows, other plugins don't, and the Marketplaces group is not shown; with the filter at `All`, Marketplaces shows.
- **AC8 – Provides-count:** Given Plugins with `kit` providing `1 skill`, when that count is clicked, then Skills shows with the chip `Plugin kit` pressed and the search box unchanged (empty).
- **AC9 – Overview links:** Given Overview with the Skills card's split `2 Project · 3 User · 1 Plugin`, when `3 User` is clicked, then Skills shows with `User` pressed; when the filter is `User`, Overview's Skills card reads 3 and its split `3 User`, and a card with no User rows is dimmed; a click on the Skills card's name shows Skills with the filter unchanged.
- **AC10 – Collapsing groups:** Given Hooks, then each event heading reads its name and count (e.g. `PreToolUse 2`) and is expanded; when `PreToolUse`'s heading is clicked (or focused and Enter pressed), its rows hide and `aria-expanded` is false; after Refresh, a switch to Config and back, and Back to the board and reopening the page, it is still collapsed; Config's `Preferences`, Permissions' `Allow` and Plugins' `Marketplaces` collapse the same way.
- **AC11 – Counts on headings follow the filter:** Given the filter at `User`, then Hooks shows only events with a User hook, each heading's count its User hooks; Config's `Settings` heading counts only User keys.
- **AC12 – Memory for the run:** Given the filter `User` and `PreToolUse` collapsed in workspace A, when workspace B's page opens, then its filter is `All` and its groups open; back in A, `User` and the collapsed group are kept; after a restart, A's page opens with `All` and every group open.
- **AC13 – Narrow and themes:** Given the page at 320 px wide in Skills with 4 chips, then the chip row wraps with no horizontal scroll; and the pressed chip's text meets D5 of #64's contrast on its background in Dark, Light and Nord (the theme test's pairs).

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – The filter in the rows:** a source filter type (All, a source kind, all plugins, a plugin key) and its match (D2) in the page's row logic: every section's rows, the summaries (counts and splits), the chips a section offers with their counts (D3, D4), the empty texts (D6); the page memory holds the filter (D10); the chip row and the Plugin chip's menu at the top of each filterable section, the section list's counts and dimming following it. Satisfies AC1–AC7, AC12 (filter part), AC13.
2. **S2 – Overview and provides-counts:** Overview's chips, card counts and split buttons (D7), and the provides-counts setting the filter (D8), with #68's provides-count e2e assertion updated. Satisfies AC8, AC9.
3. **S3 – Collapsible headings:** the heading button for Hooks, Permissions, Config and Plugins groups with its count (D9), the collapsed groups in the page memory (D10). Satisfies AC10, AC11, AC12 (groups part).

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2, AC4–AC7 | Vitest on the row logic's filter, chips and counts (`agent-setup-rows.test.ts`); e2e in `e2e/agent-setup.spec.ts` | Agent setup › Skills: click the chips, the Plugin menu, type a search |
| AC3 | e2e | Set User in Skills, show Hooks, Status; read the section list's dimming |
| AC8, AC9 | e2e | Plugins › `1 skill`; Overview › Skills card's `3 User` |
| AC10, AC11 | e2e | Hooks › click an event heading, Refresh, switch sections, Back and reopen |
| AC12 | e2e (two workspaces, one restart) | Filter and collapse in A, open B, back to A, restart |
| AC13 | e2e at 320 px; Vitest contrast pair in `app-themes.test.ts` if a new token pair is used | Resize to 320 px; switch Dark, Light, Nord |

## Stack changes

None.

## Data and migrations

None: the filter and collapsed groups are runtime only (page memory); nothing is written to the state, settings or sync files.

## Out of scope

- Denser rows (descriptions cut to one line): the developer chose to keep full descriptions.
- New groupings in Skills, Agents, Commands, MCP servers or Memory (e.g. by source).
- Saving the filter or collapsed groups across restarts.
- Collapsing Status' groups or Overview's Warnings.
- Card windows and SSH workspaces (the page shows only in the main window, and only a message for SSH).

## Open questions
