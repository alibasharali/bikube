---
item: 30
type: chore
title: 'Improve the README'
status: approved
branch: claude/30-improve-readme
---

# Improve the README

## Problem

`README.md` isn't factory-made: it has no `<!-- software-factory:readme -->` marker, no section on what Drovr does beyond its one-line summary, no way to run it from source, no pointer to the agent instructions and no *Built with Software Factory* section. What it says (installing from a release, the `board` command) still holds against the code (`electron-builder.yml`, `.github/workflows/release.yml`, `src/main/board-cli.ts`).

## Decisions

- **D1 – The `readme` skill's standard:** the README follows the skill's section order (title and summary, What it does, Links, Running it locally, Working on it, Built with Software Factory), marked as factory-made on its first line.
- **D2 – Keep what holds:** the install instructions stay as an *Install* section after *Links* (content the standard doesn't name stays where it reads well), and the `board` command stays, folded into *What it does*. *Why:* both are checked against the packaging config and the CLI and are what a user landing on the repo needs.
- **D3 – Features from the code:** *What it does* lists only what the repo ships, taken from `CONTEXT.md`, `AGENTS.md` and the e2e specs: workspaces and their columns, cards as terminals, startup commands and agent resume, split panes, settings and themes, SSH workspaces, the sync folder, the `board` command.
- **D4 – Links:** the releases page only. *Why:* Drovr is a desktop app with no deploy environments and no hosted docs.

## Acceptance criteria

- **AC1 – Factory-made:** Given `README.md`, its first line is exactly `<!-- software-factory:readme -->` and its sections follow D1's order, ending with `## Built with Software Factory` holding the factory description word for word.
- **AC2 – Nothing false:** every command in *Running it locally* exists in `package.json` or the repo, every feature in *What it does* exists in the code, and the install and `board` text kept from the old README is unchanged in substance.
- **AC3 – No regressions:** `.claude/check.sh` stays green.

## Slices

1. **S1 – README:** rewrite `README.md` per D1–D4. Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify |
|---|---|---|
| AC1 | `README.md` | `head -1 README.md`; read the headings |
| AC2 | `README.md`, `package.json` | check each command and feature against the repo |
| AC3 | all | `.claude/check.sh` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Screenshots (none in the repo).
- Moving anything into `AGENTS.md`: the old README has no architecture, env var or contributing section.

## Open questions

None.
