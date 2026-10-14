---
name: bootstrap
description: Run a new Software Factory project's first item. Agrees with the developer where to start, decides the stack when it was left to auto, sets it up (unless a tested recipe already scaffolded it), proves it works, builds the first step, turns the rest of the description into ideas on the board, and proposes what was learned to the factory's stack registry. Use when the item's description asks for it, in place of item step 4.
---

# Bootstrap

The factory created the repo with the agent kit and `docs/agents/stack.md`: the stack picked at creation, with the guidelines that come with it. The factory never assembles a scaffold from parts. Either a **tested recipe** scaffolded the repo (stack.md says so), or the repo holds only the kit and docs and **this item scaffolds it**. Report each phase with `report_progress(N, "<line>")`. Grilling, the gate, `implement-spec` and `ship` work as for any feature.

## 1. Read

- The item description: the whole project in the developer's words (also in `docs/product.md`), and the stack summary. It may describe far more than one item should build.
- `docs/agents/stack.md`: each picked option's guidelines, secrets, docs links and free-tier limits, plus anything described in words that isn't in the registry yet.
- `docs/agents/project-standard.md`: what every factory repo needs (check.sh, the `check` job, what the delivery preset needs, board URLs, instructions in `AGENTS.md`, formatters that ignore the kit).
- The repo tree. With a recipe, its `AGENTS.md` and `.claude/check.sh` already meet most of the standard.

## 1b. Deciding the stack (auto only)

When the item says the stack is auto, `.factory/stack.json` is empty and the repo holds only the kit. Choose with the developer before anything else:

1. `list_stacks()` gives the registry as a menu: categories with what belongs in each, options with what they provide, require and cost, and the tested recipes. Decide per category what your recommended first step needs (section 2), and leave a category at none unless it does; then check that nothing the description plans for later rules a pick out.
2. Prefer registry options, `proven` over `experimental`, and a recipe's combination when it fits (the best-trodden path). Every option's requirements must be met. Host on Cloudflare unless the description or the app's shape rules it out: it is the only platform the factory provisions. Prefer free tiers, and name what anything else costs.
3. What the registry lacks goes in words under the category whose description fits it best. If none fits, use the nearest and say so in the question.
4. The first `ask_questions` round opens with **"Proposed stack"**: your proposal (recommended) and one or two real alternatives, each listing the pick per category, why, and the costs; add separate questions only where a single choice is close. Nothing is scaffolded before the answer.
5. The approved stack becomes the spec's first domain decisions. The scaffold slice writes it to `.factory/stack.json` and commits the files `render_stack_files` returns; hosting on Cloudflare starts with `provision_hosting`, as the project standard's last section says. Anything described in words is proposed to the registry in the last slice (section 5).

## 1c. Reviewing a picked stack (chosen, not auto)

The developer chose the stack at creation, and the factory only checked that the picks fit together. Check that they suit this app before anything is built on them:

- **Fit**: does each pick suit what the description says the project is (a static site on a server-rendered stack, a desktop app on a web host, a database for an app that stores nothing)?
- **Maturity**: an `experimental` option where a `proven` one does the same job (`list_stacks()` shows both).
- **Cost**: anything beyond a free tier, with what it costs.
- **Overlap**: picks that do the same job twice.

With concerns, the first `ask_questions` round opens with **"Stack review"**: keep the picks, or your alternative (recommended when you'd change it), each with the reason and the cost. One question per concern only when they are independent. Nothing is scaffolded before the answer. Without concerns, say so in one line in your progress report and carry on. You never change the stack on your own: what the developer decides goes in the spec as a domain decision, and the scaffold slice writes it to `.factory/stack.json` with the files `render_stack_files` returns. When a recipe already scaffolded the repo, review the same way; a change becomes rework the spec names.

## 2. Where to start

The developer described the project, not the first item. The first `ask_questions` round always asks **"First step"**, next to the stack question when there is one: two or three options, each saying what gets built and what it proves, with your recommendation and why. Judge from the description and the stack:

- **One part could sink the project** (a native or terminal layer, an unfamiliar API, real-time sync, performance at the scale described): recommend a proof of concept of that part, deployed or released through the real pipeline, before anything is built around it.
- **Nothing like that**: recommend the smallest thing that runs end to end where the delivery preset ships it: the scaffold plus one real page or screen.
- Never more than that. A first step that builds most of the description leaves nothing to learn from before the rest.

The answer is the spec's **Scope** decision. Everything else the description asks for goes in the spec's **Later** section (section 3).

## 3. Questions and spec

Grill with `ask_questions` as `write-spec` describes: about the first step itself, and when scaffolding, about what the stack leaves open (versions, package manager, layout, how the parts connect). A category left at "none" stays none: if the first step seems to need it (a database, auth), ask rather than add it. If the description and the picked stack disagree (it says Postgres, D1 was picked), ask in the first round with both as options and your recommendation; never settle it silently, and don't scaffold before the answer. The answer goes in the spec as a domain decision, and `.factory/stack.json` follows it.

Then write the spec with `write-spec`. Without a recipe, its first slice is **"Scaffold and prove the stack"**, with acceptance criteria from the project standard: check.sh green, the `check` job, the deploy workflow with environment names, the URLs, the instructions, the formatter's ignore file when the stack has a formatter. The first step's behaviour follows in later slices.

The spec adds three things for this item:

- **Later**: what the description wants that the first step doesn't build, one line each: a title and what it is, pointing to the description's part. Group by feature rather than by sentence, at most about ten; what is too vague to act on stays only in `docs/product.md`. The developer reviews this list with the spec, so cutting or adding to the plan happens here.
- A slice **"Put the plan on the board"**, the first one after the scaffold (or the first, with a recipe): `create_item(title, description, "idea", N)` for each line of Later, the numbers recorded in the ledger so a resumed session doesn't create them twice. AC: every line of Later is an idea on the board. Ideas stay in Backlog until the developer promotes them.
- A slice **"README"**, just before the registry slice: write `README.md` with the `readme` skill, from what the first step built (improving the recipe's README when there is one). AC: the root `README.md` starts with `<!-- software-factory:readme -->` and follows the skill's standard.

Publish with `attach_spec(N, path, summary, branch, title)`, titling the item after the agreed first step (e.g. "PoC: terminal in Electron", "Scaffold and first page"): its "Start: …" title only stood in until now. The **last slice is always "Contribute to the stack registry"** (section 5), with the AC: `propose_stack_change` returned a pull request, linked in the item's PR, or the ledger says why there was nothing to propose. It goes in the spec because implementation runs in a later session that only has the spec.

## 4. Scaffold (no recipe; the first slice after approval)

- Start from each framework's **official generator** at its current version (`npm create …`, `dotnet new …`), never from files written from memory; then shape the result to the stack's guidelines. Check versions and APIs against the docs links in stack.md: your training data may be out of date.
- Wire the parts together the way the guidelines say, and only the parts that were picked.
- **Hosting on Cloudflare**: follow the project standard's last section (`provision_hosting`, then the deploy workflow, then `set_environment_urls`).
- **Other hosting**: the factory can't provision it. Write the deploy workflow with the environment names, list the accounts and secrets it needs, and `request_attention` for the developer to create them. Never sign up for anything or move to a paid plan.
- Stack skills from the factory are in `.claude/skills/` (listed at the end of stack.md); use them, e.g. for migrations.
- **Declare it**: `.factory/stack.json` already lists what was picked. Keep it true to what you scaffolded (`render_stack_files` for the matching stack files), and make `.claude/check.sh` run `node .factory/check-stack.mjs`.
- **Prove it**: `.claude/check.sh` passes and the dev server serves the app. The first real deploy, where the delivery preset deploys, happens when the PR merges into the base branch; say in the PR that the developer should watch it.

## 5. Contribute what you learned

The next project with this stack should start where you finished. This is the spec's last slice; record in the ledger, as you go, every guideline that turned out wrong or missing, so the slice has them:

- **A stack described in words** (not in the registry, whether the developer wrote it or auto chose it): call `get_stack` with any existing id to see the format, then `propose_stack_change(N, summary, files)` with a new `options/<id>/stack.json` (category, what it provides and requires, docs, secrets, checks, free-tier costs, how to detect it in a repo; `status: "experimental"`) and a short, dated `guidelines.md`. Add a skill when there is a procedure worth more than a few lines.
- **A guideline in stack.md that was wrong or missing**: `get_stack(id)` for the current files, then propose the corrected `guidelines.md`.
- One call per item carries everything: a later call replaces the earlier proposal, so send all files each time.
- The factory checks the proposal against the whole registry and opens a pull request on its own repo. Fix what it reports and call again. Tell the developer the PR is waiting for their review, and link it in your PR. With a recipe and nothing learned, the ledger says so and the slice is done.

## 6. Build the first step

The remaining slices are the first step's behaviour, through `implement-spec` and `ship` as usual.

## 7. When the plan changes

Ideas evolve. When building shows that part of the plan is wrong (the PoC rules an approach out, a feature turns out overengineered), say so in the PR with the ideas it affects, and update `docs/product.md` in the same PR once the developer agrees: what changed in the description, and what was cut under *Dropped* with why. You never delete or rewrite items; the developer does that on the board.
