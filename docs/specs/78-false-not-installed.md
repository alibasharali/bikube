---
item: 78
type: bug
title: Claude Code and Codex shown "(not installed)" when they are on the PATH from ~/.zshrc
status: approved
branch: claude/78-false-not-installed
---

# Claude Code and Codex shown "(not installed)" when they are on the PATH from ~/.zshrc

## Problem

A user with Claude Code and Codex in `~/.local/bin` (`which claude` in their terminal prints `/Users/<them>/.local/bin/claude`) sees both as `(not installed)` in the New card and workspace selects, while OpenCode and Pi (in Homebrew's `/opt/homebrew/bin`) show as installed. The installed-agents check (`src/core/installed-agents.ts`) runs the login shell as `zsh -l -c '<check>'`: a login shell that is **not interactive**, so zsh reads `.zshenv`, `.zprofile` and `.zlogin` but never `.zshrc`. Claude Code's native installer (`curl -fsSL https://claude.ai/install.sh | bash`) and Codex's add `~/.local/bin` to PATH in `~/.zshrc`, so the check never sees it. A card's shell is a login shell in a PTY, so interactive: it reads `.zshrc` and finds both, which is why the agents run fine in cards. Another user with the same folder has the PATH line in `.zprofile` (or `.zshenv`), so it works for them. Agent setup's Status row (`src/core/claude-version.ts`, the same `-l -c` plan) reads `Not installed` for the same user.

## Fix

Both checks run the login shell interactive too, `-l -i -c`, so it reads the same startup files as a card's shell (zsh's `.zshrc`, fish's interactive config, bash's login files as before). Whatever an interactive profile prints is already ignored (only `bikube-found` / `bikube-version` lines count); stdin stays closed and the process detached with no controlling terminal, so a profile waiting for input reads EOF and job-control warnings go to the ignored stderr; the 15 s timeout still turns a hung profile into "unknown", which shows nothing as not installed.

## Acceptance criteria

- **AC1 – PATH from .zshrc:** Given zsh as the login shell with a command's folder put on PATH only in `.zshrc`, when the installed-agents check runs, then that agent is found (before: not found).
- **AC2 – Claude Code's Status row:** Given the same setup with a fake `claude`, when `readClaudeVersion` runs, then it reports `claude` installed at that path with its version.
- **AC3 – Unchanged elsewhere:** the existing checks (a PATH from `.profile`/`.zprofile` under sh, bash and zsh, fish's config, no agents, a missing shell and a hung profile reading null) still pass.

## Slices

1. **S1 – Interactive login shell for the agent checks:** `installedPlan` and `claudeVersionPlan` pass `-l -i -c`; Vitest cases for AC1 and AC2 with a fake `.zshrc` (skipped where zsh is missing, as the existing zsh cases). Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify |
|---|---|---|
| AC1 | Vitest, real zsh | `npx vitest run src/core/installed-agents.test.ts` |
| AC2 | Vitest, real zsh | `npx vitest run src/core/claude-version.test.ts` |
| AC3 | Vitest, e2e | `.claude/check.sh`; `e2e/presets.spec.ts` (`(not installed)` with only the fake `claude`) |

## Out of scope

- The editor check and opening (`installed-editors.ts`, `editor.ts`) and the PR chip's `gh` (`pr-status.ts`) still run `-l -c`; an editor or `gh` put on PATH only from `.zshrc` has the same blind spot. A follow-up can move them to the same plan once this one has proved itself.

## Stack changes

None.
