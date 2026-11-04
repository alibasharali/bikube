---
item: 79
type: feature
title: Files and artifacts in the Agent tab
status: approved
branch: claude/79-agent-tab-files-artifacts
---

# Files and artifacts in the Agent tab

## Problem

Claude Code often makes things for the user that aren't code changes in the repo: a PDF saved to `~/Downloads`, a spreadsheet, a chart, a claude.ai artifact or doc. The Agent tab (#75) shows only What changed (repo edits) and Commands, so the only way to find a PDF again is to scroll the terminal for the path Claude printed ("I've saved the PDF to /Users/…/x.pdf"), and an artifact's link through `/artifacts`. The developer wants one place in the Agent tab that lists them, where a click opens each one.

What a transcript holds (checked against real sessions, 2026-11-04):

- A `Write` tool use names its file in `input.file_path`.
- A file a script writes appears only in the `Bash` command (`OUT="$HOME/Downloads/Managed Service Migrator - PostgreSQL cost parameters.pdf"; …`) and in Claude's reply text.
- An artifact's link, `https://claude.ai/artifact/<id>` (or `https://claude.ai/code/artifact/<uuid>`), appears in tool results: the `Artifact` tool's (`toolUseResult` `{ url, title, … }`) and the Claude Docs tools' (`frame.url`, after a `batch` whose `container.create.name` is the title).

## Decisions (developer, 2026-11-04)

- **D1 – Which files:** documents anywhere. An absolute path (or one starting with `~/` or `$HOME/`) whose extension is in `OUTPUT_EXTENSIONS`, named by a `Write` tool use, a foreground `Bash` command or the main agent's reply text, and still a regular file on disk, inside the card's folder or outside it. Code and text files (`.ts`, `.md`, `.json`, `.txt`, …) stay What changed's.
- **D2 – Opening a file:** with the OS default app (`shell.openPath`: Preview for a PDF), and a Reveal button on each row (`shell.showItemInFolder`).
- **D3 – Scope and place:** the whole session, newest first, in a fourth group `Files and artifacts` after What changed; its first 10 rows, then `Show all (<n> more)` / `Show fewer` (#77's `ShowAllButton`).
- **D4 – Artifacts:** any `claude.ai` artifact link in a tool result or the main agent's reply text. A row shows the title (else the link) and a `Doc` or `Page` badge when known, and a click opens the link in the browser (`link:open`).

## Design

- **D5 – Extensions:** `OUTPUT_EXTENSIONS` in `src/core/agent-outputs.ts` (Node-free): `pdf`, `doc`, `docx`, `odt`, `rtf`, `pages`, `xls`, `xlsx`, `ods`, `csv`, `tsv`, `numbers`, `ppt`, `pptx`, `odp`, `key`, `html`, `htm`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `heic`, `mp3`, `wav`, `mp4`, `mov`, `zip`, `epub`, matched in any case.
- **D6 – Finding paths:** `outputPaths(text)` in `agent-outputs.ts` finds candidates in a command or reply: from a `/`, `~/` or `$HOME/` (also `${HOME}/`) at the start of a word or after a quote, `(`, `` ` `` or `=`, up to the first `.<extension>` from D5 followed by the end, whitespace, a quote, `` ` ``, `)` or `.,;:!?` and then whitespace or the end. Spaces are allowed inside, line breaks aren't; at most 300 characters. A `Write`'s `file_path` is taken as is when its extension matches. `~` and `$HOME` are kept as written in the summary and expanded by main.
- **D7 – Left out:** paths under `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders`, `~/.claude` and any `node_modules` or hidden (`/.`) folder: scratch files, screenshots and Claude's own state.
- **D8 – Parsing:** `addTranscriptLine` keeps `outputs` in the `TranscriptState` (main transcript only; subagents' files and artifacts reach it through the main agent's reply anyway). A Bash command's paths count once its result isn't an error or denial (as `changes`, #75 D9); a `Write`'s once its result came; reply text on reading. Each output is `AgentOutput`: `{ kind: 'file', path, at }` or `{ kind: 'artifact', url, title?, type?: 'doc' | 'page', at }`, with `at` its entry's timestamp. One row per path or URL, seen again moving it to newest and a later title replacing the old one. Title and type: the `Artifact` tool's result `title` and `page`; a Claude Docs tool's (`mcp__*Claude_Docs__*`) `doc`, its title from that container's `create.name`. Newest `SUMMARY_LIMITS.outputs` = 200 kept. `agentSummary` gives `outputs` (absent while empty).
- **D9 – On disk:** main checks each file output when it answers `agentTab:summary` and `agentTab:sessionSummary` (`~`/`$HOME` expanded with `userHome()`, `lstat`, a regular file or a link to one) and leaves out the rest; the reply's `version` also changes when that set changes, so `unchanged` stays right while a file appears or is deleted.
- **D10 – Opening:** IPC `agentTab:openOutput` and `agentTab:revealOutput` (`src/main/agent-tab.ts`, main frame only) take the session id and the path as the summary gave it; main opens it only if the last summary it read for that session listed it and it is still a regular file (as Agent setup's `ListedPaths`, #68 S6), else `file not found`. A failure shows the Files tab's error line under the group (`src/core/open-result.ts`).
- **D11 – Rows:** `src/renderer/src/AgentOutputs.tsx`: a file row is a button with `fileIcon`'s icon, its file name, and its folder muted under it (`~` for the home); its Reveal icon button on hover and focus, always in the Tab order. An artifact row is a button with a link icon, the title, the `Doc` or `Page` badge, and `claude.ai` muted under it. Empty: `No files or artifacts yet.` The group's count is the rows shown. Long names truncate with an ellipsis; no sideways scroll at `sidePanelWidth` 200.
- **D12 – Not for:** SSH cards and shells (the Agent tab's message already), What changed's views (D3 is always the whole session).

## Acceptance criteria

- **AC1:** A `Write` of `<home>/Downloads/a.pdf` with its result shows `a.pdf` with `~/Downloads` under it; a `Write` of `src/x.ts` shows nothing.
- **AC2:** A `Bash` command `OUT="$HOME/Downloads/Cost report - v2.pdf"; …` whose result is OK shows `Cost report - v2.pdf` once the file exists, and none while it doesn't; a denied or failed one shows nothing.
- **AC3:** The reply text `I've saved it to /…/home/Downloads/b.xlsx.` shows `b.xlsx`; a `/tmp/c.png` or `~/.claude/d.png` named anywhere shows nothing.
- **AC4:** Clicking a file row opens it with the default app (`shell.openPath` stubbed); its Reveal calls `shell.showItemInFolder`. A path the summary never listed, asked for from the page, opens nothing. A file deleted after it was listed leaves the list within 3 s.
- **AC5:** An `Artifact` publish result with `url` and `title` shows the title with `Page`; a Claude Docs `batch` creating `Plan` whose result holds a `claude.ai/artifact/…` link shows `Plan` with `Doc`; a link in the reply text alone shows the link. A click opens the URL (`shell.openExternal` stubbed). The same URL twice is one row, at its newest place.
- **AC6:** With 12 outputs the group shows 10 and `Show all (2 more)`, then `Show fewer`; collapsing it is kept across cards for the run, as the other groups.
- **AC7:** Rows, badges and the empty line use theme tokens in Dark, Light and Nord, with no sideways scroll at `sidePanelWidth` 200 with a long file name.

## Slices

1. **S1 – Parsing:** `src/core/agent-outputs.ts` (`OUTPUT_EXTENSIONS`, `outputPaths`, D7's filter) and `outputs` in `agent-summary.ts`, Vitest from fixture lines (Write, Bash with quotes and `$HOME`, reply text with a sentence's full stop, artifacts from both tools, dedup, limit). Satisfies the parsing parts of AC1–AC3, AC5.
2. **S2 – Main:** D9's on-disk check and version in `src/core/agent-transcript.ts` (fs injected, Vitest on temp folders), D10's IPC, the preload and `src/shared/api.ts`. Satisfies AC4's checks.
3. **S3 – The group:** `AgentOutputs.tsx`, `AGENT_TAB_GROUPS`, CSS, e2e in `e2e/agent-tab.spec.ts` from fixture transcripts in the fake home. Satisfies AC1–AC7.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC3, AC5 | Vitest on `outputPaths` and `agentSummary`; e2e fixture transcripts | A Claude Code card that saves a PDF to `~/Downloads` and publishes an artifact |
| AC4 | Vitest on the listed-path check; e2e with `shell.openPath`/`showItemInFolder` stubbed via `app.evaluate` | Click the PDF row: Preview opens it |
| AC6 | e2e with 12 outputs | Same card, many files |
| AC7 | e2e colours and scroll width, as #75 AC17 | Switch App theme |
