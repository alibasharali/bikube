---
name: readme
description: Write or improve a repo's README to the factory's standard, marked as factory-made and ending with a Software Factory section. Use when writing or improving a README, for the README slice of an onboarding or bootstrap item, and for "Write the README" / "Improve the README" chores.
---

# README

A README tells a person who lands on the repo what the project is, where it runs and how to start it. Agent instructions live in `AGENTS.md` / `CLAUDE.md`, not here. Write it as part of the item's branch, like any other change.

## 1. Find the README

The README is a file at the repo root whose name, ignoring case, is `README` or `README.<ext>` (`README.md`, `readme.rst`, `Readme.txt`, `README`). Directories don't count, nor do `docs/README.md` or `README-dev.md`. With several, the one named `README.md` (any case) is the README; otherwise the first by name.

- **None**: write one (section 3).
- **Not markdown** (`README`, `readme.rst`, `Readme.txt`): improve it into `README.md` and delete the old file in the same commit.
- **Already contains `<!-- software-factory:readme -->`**: it is factory-made. Improve it only where it no longer holds.

## 2. Facts first

Read before writing, and take every fact from the repo, never from memory or guesswork:

- What the project does: `docs/product.md` when there is one, the item, the code's entry points.
- Where it runs: the deploy workflow, the hosting config (`wrangler.*` and similar), the URLs the item set with `set_environment_urls` or that `AGENTS.md` names. No deploy, no links section for environments.
- How to run it: the commands in `package.json` (or the stack's equivalent) and `AGENTS.md`. Run each one you list, or check it exists, before writing it down.

## 3. The standard

The first line is exactly `<!-- software-factory:readme -->` (it marks the README as factory-made, so the factory doesn't offer to write it again). Then, in this order:

1. `# <name>` and a one-line summary.
2. **What it does**: a short paragraph or list.
3. **Links**: the prod and dev URLs where it deploys, and docs. Leave the section out when there are none.
4. **Running it locally**: setup and dev commands, verified against the repo.
5. **Working on it**: one line pointing to `AGENTS.md` (or `CLAUDE.md`) and `docs/agents/workflow.md`.
6. `## Built with Software Factory`, last: one sentence that the project is created and managed by Software Factory, then this description word for word, with no link (the factory's repo may be private):

   > Software Factory is a personal control plane for software projects: it scaffolds or imports each repo, tracks work on a per-project board, and has Claude Code sessions take each item from spec to pull request, while the developer approves specs and decides what ships.

No architecture, environment variable or contributing sections: architecture and conventions belong in the agent instructions, secrets nowhere. Keep it short; a README that needs scrolling to find how to run the app is too long.

## 4. Improving an existing README

- Keep every statement that still holds, checked against the code; drop what is false (a removed command, a dead URL, a feature that is gone).
- Fit what you keep into section 3's order, under its sections.
- Content the standard doesn't name stays where it reads well: badges (under the title), licence, screenshots, acknowledgements.
- Architecture, env var and contributing sections don't belong in the README (section 3). Move what still holds in them into `AGENTS.md` (or `CLAUDE.md` when the repo keeps everything there), adding to the existing file under a fitting heading; drop only what is false. Name each move in your report.
- Never invent URLs, commands or features. When a fact you need isn't in the repo, leave it out and say so in your report.
