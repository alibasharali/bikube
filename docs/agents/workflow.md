# Workflow: from item to delivery

How every change in this repo is made. Managed by Software Factory's agent kit (`.claude/kit-version`); don't edit this file here, changes are overwritten by the next kit update. Project-specific rules belong in the repo's instructions and `.claude/rules/`.

**Instructions** means `AGENTS.md` and `CLAUDE.md`: `AGENTS.md` is read by every coding agent, and in projects the factory creates `CLAUDE.md` imports it (`@AGENTS.md`), so it holds the shared instructions. Older repos may keep everything in `CLAUDE.md`. Wherever the kit says `CLAUDE.md`, read both.

## What Software Factory is

The developer's personal control plane for all their projects. Each project has a board in the factory; each board item is worked on by Claude sessions the factory starts, and moves from idea to production without the developer driving git by hand. The factory scaffolds new projects and imports existing ones, and every project follows this same workflow, so the board, pipelines and releases work the same everywhere. What that relies on, in every repo:

- items, specs and branches named as below, so the factory can link them;
- `.claude/check.sh` as the one definition of green, run by agents, hooks and the `check` job on every PR;
- the project's **delivery preset** (below), which fixes the base branch and how the board learns that work shipped;
- the developer deciding: specs, what ships, anything that costs money or touches secrets. Agents do the work in between.

## Overview

```
Backlog → Spec → Ready to build → In progress → In review → (delivery columns, per preset)
          grill   you approve      slices+TDD    PR→base branch
```

Work items live on the project's board in **Software Factory**, not in GitHub Issues. Agents reach the factory through the `factory` MCP server (`.mcp.json`).

| Column | Meaning | Who moves it |
|---|---|---|
| Backlog | item exists, no work started | — |
| Spec | agent is grilling the developer and writing the spec | agent |
| Ready to build | the developer approved the spec, in the session or with the factory's approve button (or sent it back with **Request changes**) | agent on the developer's word, or the factory on the button |
| In progress | slices being implemented | agent |
| In review | PR into the base branch open; CI and Claude review running | factory, when the agent opens the PR |
| delivery columns | see the preset | factory (GitHub webhooks) |

Item types: **feature** runs the full flow. **bug** and **chore** get a short spec with no grilling and no approval gate, and start at *In progress*. **idea** stays in Backlog until the developer promotes it (or full auto does, below). **issue** came from a GitHub issue and stays in Backlog until the developer triages it; once it's a feature, bug or chore it keeps the link, the factory adds `Refs #N` to its PR and closes the issue when the work is delivered.

## Delivery

Every project has one delivery preset. `get_item` returns it as `delivery`, with `baseBranch`: branch from it, open the PR into it, never assume `develop`.

| Preset | Base branch | After *In review* | Who merges |
|---|---|---|---|
| Dev and prod | `develop` | *On dev* when the dev deploy contains the merge, *In prod* when the prod deploy does; the developer merges the `develop → main` release PR (merge commit, never squash: it would make every later release PR conflict) | GitHub auto-merge, or the developer |
| Straight to prod | `main` | *In prod* when the prod deploy contains the merge | the developer: the merge ships |
| Releases | `main` | *Merged* on merge, *Released* when a published GitHub release contains it (pre-releases only show on the item's timeline) | GitHub auto-merge, or the developer |
| Merge only | `main` | *Done* on merge | the developer: the merge is the delivery |

Deploys report through GitHub Actions jobs with `environment: dev` / `prod`; releases are the repo's own release workflow. The factory follows both, it never deploys or publishes.

## Artifacts

- **Spec** `docs/specs/<n>-<slug>.md`: written for agents, the single source of truth for what gets built. Front matter: `item`, `type`, `status: draft | approved`, `branch`.
- **Ledger** `docs/specs/<n>-<slug>/progress.md`: slice status and the developer's rulings. It lets a restarted session resume.
- **Stack** `.factory/stack.json`: the stack this repo uses, declared by the repo itself and synced into the factory on every merge into the base branch. It changes in the same PR as the code that adds or removes a stack (`.factory/check-stack.mjs` in `check.sh` fails otherwise, and a hook tells you right after you edit dependencies). `docs/agents/stack.md` holds the guidelines that come with it, generated: get both from `render_stack_files(N, stack_json)`. Read stack.md before touching dependencies, infrastructure or deploys. What every repo needs regardless of stack is in `docs/agents/project-standard.md`.
- **Product** `docs/product.md`: what the product is and why, and the ideas dropped along the way, started from the developer's description at creation (imported repos may not have one). The board holds the plan; this file holds the direction. Read it before proposing features, and update it in the PR of an item that changes the direction, once the developer agrees.
- **Branch** `claude/<n>-<slug>`, from the base branch. One item, one branch, one PR into the base branch.
- No proof files in the repo. Verification is a short summary in the PR body and on the item.

## Steps

1. **Start.** The factory fires a session with the item. The `item` skill reads it (`get_item`), finds where it stands, and resumes.
2. **Spec** (`write-spec`). Features: grill the developer on every open decision in rounds of questions on the item page (options, a recommendation, free text), then write and push the spec. Bugs/chores: a short spec, no grilling. A new project's first item uses `bootstrap`, which agrees with the developer where to start (a proof of concept of the riskiest part, or the smallest thing that runs end to end), scaffolds the picked stack when no tested recipe did, turns the rest of the description into ideas, and records what it learned about stacks the factory doesn't know yet. An imported repo's first item uses `onboard` first, which specs what the repo lacks compared with a new factory project (checks, PR CI, what its delivery preset needs, URLs, `CLAUDE.md`).
3. **Gate** (features only). The developer reads the spec and approves it: by saying "approved" in the session, or with **Approve** on the item page, which records the spec's blob SHA and starts a fresh session. No production code before that. Under full auto the session approves its own spec unless it changes the stack (below).
4. **Implement** (`implement-spec`). The session orchestrates: a fresh `slice-implementer` builds each slice test-first, the orchestrator commits, a `slice-reviewer` checks it.
5. **Verify.** All checks green (`.claude/check.sh`), then the `verifier` subagent checks every acceptance criterion against the running app and returns a summary. Nothing is written to the repo.
6. **Ship** (`ship`). Review the branch in a fresh subagent and fix findings, run the retro (`lesson`), push, and open the PR through `open_pull_request`. The factory moves the item to *In review* and turns on auto-merge where the preset and GitHub allow it.
7. **Review.** CI and the Claude review run on the PR. The review fixes unambiguous findings (`fix(review): …`) and leaves an unresolved thread for everything else. Reply `@claude <what you want>` in a thread to have Claude fix it. Then the PR merges into the base branch (squash) one of two ways: GitHub auto-merges it once CI and the review pass and every thread is resolved, where the preset allows it and the repo has rulesets (public repos, or GitHub Pro); otherwise the developer presses **Merge** on the item in the factory, which only merges with the required checks green. Agents never merge.
8. **Deliver.** Per the preset: the developer tests on dev and merges the release PR, a deploy or a published release ships it, or the merge itself was the delivery.

## Full auto

The developer can run lights-out (the factory working through the board one item at a time, unattended) with **Full auto**. It then also takes features in *Spec* and items in *Backlog* (never issues, nor a project's first `bootstrap` or `onboard` item), and the session works without the developer:

- an idea is promoted (`promote_item`) or declined (`decline_idea`) by the session;
- grilling rounds are answered at once with the session's recommendations;
- the session approves its own spec and builds it in the same session.

Money, secrets and stack changes stay the developer's: such a round is asked `for_developer`, a spec with a stack change waits for their approval, and lights-out waits on the item meanwhile. Sessions act on full auto only when `get_item` returns `fullAuto: true`. Every decision it made is on the item's timeline and in the PR's *Decided by full auto* section.

## Guardrails

| Layer | What it enforces |
|---|---|
| Code | `.claude/check.sh` (tests, typecheck, build: project-defined) |
| Harness (`.claude/settings.json`) | no reading secrets (`.env*`, `.dev.vars*`); Stop hook runs `.claude/check.sh` |
| GitHub | With rulesets (public repos, or GitHub Pro): the base branch needs a PR, CI and Claude review green, conversations resolved, squash merge; in Dev and prod, `main` needs a PR, CI green, merge commit only (keeps develop's history in main), human merge. Without rulesets (private repos on GitHub Free) nothing is enforced on GitHub: the same rules hold because merges go through the factory's Merge buttons, so never push to `develop` or `main` directly |
| Factory | agents move items one column forward at most, never into the delivery columns |

## Learning loop

A correction becomes a guardrail through the `lesson` skill, which runs when the developer corrects the agent and in every `ship` retro. Project lessons land in this repo. Lessons about the workflow itself (this file, the skills, hooks) go to the factory with `kit_feedback`, because kit files are overwritten on update. Lessons about a stack (true in any repo using it) go to the factory's stack registry with `propose_stack_change`, which opens a pull request the developer reviews on the factory's Stacks tab; once merged, every repo with that stack gets it in its next Update kit. A proposal never blocks the item: link it and carry on, without waiting for the merge or calling `request_attention`.
