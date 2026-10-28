---
item: 72
type: chore
title: Sandbox section in Agent setup
status: approved
branch: claude/72-agent-setup-sandbox
---

# Sandbox section in Agent setup

## Problem

Claude Code's `sandbox` settings key (enabled, network domains, filesystem write and read rules, excluded commands) is only visible today as one long JSON line in Config. After this ships, the Agent setup page (#68) has a **Sandbox** section in the Context group, after Permissions, showing the effective sandbox switches and every list entry with where it is set, read-only, as Permissions shows its rules.

Related: #71 (in progress, same page; its source filter and collapsible headings). Whichever merges second makes Sandbox follow #71: its lists filter by source like Permissions' rules and its list headings collapse like Permissions' groups (#71 D2, D9).

## Domain decisions

- **D1 – Where:** a section `sandbox`, label `Sandbox`, hint `Where Claude Code's Bash sandbox lets commands write, read and connect`, in the Context group between Permissions and Config, with its own icon in the section list and an Overview card (its count and source split, as every section's). Status and Stats are not changed.
- **D2 – Read from the three settings files:** the snapshot already holds each settings file's top-level object (`settings`, D10's precedence: Local, Project, User); the section reads each file's `sandbox` object there, so the reader, main and IPC are unchanged. A `sandbox` that isn't an object is ignored in that file. Managed settings are not read (as elsewhere on the page). Bikube's own settings file sets no sandbox.
- **D3 – Values by precedence, lists merged:** as Permissions does (D20): a single value (boolean, number or string) at any depth under `sandbox` is shown once, from the first file by precedence that sets it, with its source chip and Open file/Reveal; arrays of strings are merged: every entry of every file, by precedence, each with its source chip and Open file/Reveal. *Why:* Claude Code merges sandbox path and domain lists across scopes, and a scalar from a higher scope wins.
- **D4 – Facts:** a facts list at the top: `Enabled` (`sandbox.enabled`; `Off` when no file sets it), `Fail if unavailable` (`failIfUnavailable`), `Allow unsandboxed commands` (`allowUnsandboxedCommands`), `Auto-allow Bash when sandboxed` (`autoAllowBashIfSandboxed`), `Strict allowlist` (`network.strictAllowlist`), `Allow local binding` (`network.allowLocalBinding`); a known key no file sets reads `Not set`, except `Enabled`. Any other single value under `sandbox` follows as a fact named by its dotted path (`network.httpProxyPort`). Facts are never filtered by the search and not counted (as Permissions' Default mode).
- **D5 – Lists:** groups, each a subheading and its rows (`None` when empty): `Allowed domains` (`network.allowedDomains`), `Denied domains` (`network.deniedDomains`), `Allow write` (`filesystem.allowWrite`), `Deny write` (`filesystem.denyWrite`), `Allow read` (`filesystem.allowRead`), `Deny read` (`filesystem.denyRead`), `Excluded commands` (`excludedCommands`), then any other array of strings under `sandbox` named by its dotted path, shown only when some file sets it. Entries are shown as written (`~/.ssh`, `*.github.com`), never expanded. Non-string items and arrays of objects are left out of the lists.
- **D6 – Search and count:** the search (D25) matches a list entry by its text, its group's name and its source label; a group with no matching entry reads `None`. The section's count (section list, Overview card) is the number of matching list entries; its split by source as every section's.
- **D7 – Config:** `sandbox` joins Config's excluded keys (as `permissions` and `hooks`), since its own section shows it.
- **D8 – Empty:** with no file setting `sandbox`, the section shows `Enabled Off`, the other known facts `Not set`, every list `None`, and the line `No sandbox settings. Add a "sandbox" object to .claude/settings.json or ~/.claude/settings.json.`

## Acceptance criteria

- **AC1 – Section list:** Given any local workspace's Agent setup page, then the Context group reads Memory, Permissions, Sandbox, Config, and Down from Permissions shows Sandbox.
- **AC2 – Facts:** Given `~/.claude/settings.json` with `sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, network: { strictAllowlist: true, allowLocalBinding: true, httpProxyPort: 8080 } }` and the workspace's `.claude/settings.local.json` with `sandbox: { enabled: false }`, when Sandbox shows, then `Enabled` reads `false` with a `Local` chip, `Fail if unavailable` `true` `User`, `Allow unsandboxed commands` `false` `User`, `Strict allowlist` `true`, `Allow local binding` `true`, `Auto-allow Bash when sandboxed` `Not set`, and a fact `network.httpProxyPort` reads `8080`.
- **AC3 – Merged lists:** Given the User file also sets `network.allowedDomains: ["github.com", "*.github.com"]`, `filesystem.denyRead: ["~/.ssh"]`, `excludedCommands: ["git push:*"]` and the Project file `.claude/settings.json` sets `network.allowedDomains: ["registry.npmjs.org"]`, then Allowed domains lists `registry.npmjs.org` (Project) then `github.com`, `*.github.com` (User), Deny read `~/.ssh`, Excluded commands `git push:*`, Denied domains `None`, and the section list's Sandbox count reads 5.
- **AC4 – Search:** Given that workspace, when `github` is typed in the search, then Allowed domains shows only `github.com` and `*.github.com`, the other lists read `None`, the facts are all still shown, and the Sandbox count reads 2.
- **AC5 – Config:** Given that workspace, when Config shows, then it has no `sandbox` row.
- **AC6 – Empty:** Given a workspace with no `sandbox` in any settings file, when Sandbox shows, then `Enabled` reads `Off`, every list reads `None`, and the `No sandbox settings…` line shows; Overview's Sandbox card reads 0.
- **AC7 – Open file:** Given AC3's workspace, then the `registry.npmjs.org` row's Open file and Reveal name `.claude/settings.json` (as Permissions' rows do).

## Slices

1. **S1 – Sandbox section:** the section id, label, hint and place; the sandbox view's rows (facts and merged lists, search, count) in the page's row logic beside Permissions', its summary in the section summaries, `sandbox` in Config's excluded keys; the section view (facts list, list groups with source chips and file actions, empty line) and its icon. Satisfies AC1–AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest `agent-setup-sections.test.ts`; e2e | Open Agent setup, read the section list, Down from Permissions |
| AC2–AC6 | Vitest on the sandbox rows in `agent-setup-rows.test.ts`; e2e in `e2e/agent-setup.spec.ts` with a fake home | Sandbox section with the fixture settings files, type `github` |
| AC7 | e2e (Open file recorder as S6's) | Hover a row, Open file |

## Stack changes

None.

## Data and migrations

None: read-only, from what the snapshot already holds.

## Out of scope

- Editing sandbox settings from the page.
- Managed (enterprise) settings, and checking whether the sandbox is available on this machine.
- Expanding `~` or globs in paths, or validating domains.
