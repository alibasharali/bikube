---
name: onboard
description: Bring a repo imported into Software Factory up to what a newly created factory project has (checks, PR CI, what its delivery preset needs, URLs on the board, agent instructions). Use for the "Onboard into the factory" item, in place of item step 4.
---

# Onboard

The import added the kit and what it could decide alone. This skill finds the rest and turns it into the item's spec. The target is `docs/agents/project-standard.md`; the stack the repo declares is in `.factory/stack.json` (from the import page or the factory's Detect stack), with its guidelines in `docs/agents/stack.md`. It runs inside the normal flow: grilling, the gate, `implement-spec` and `ship` work as for any feature. Report each phase with `report_progress(N, "<line>")`.

## 1. Facts first

Read `docs/agents/project-standard.md`, then gather these before asking anything:

- Language, package manager and frameworks; a monorepo's packages.
- Run `.claude/check.sh` as the import left it, and note what fails or is missing.
- CI and deploy workflows: what they run, on which branches, and which job deploys.
- Hosting config: `wrangler.*`, `vercel.json`, `netlify.toml`, `fly.toml`, `Dockerfile`, Supabase, Firebase and similar.
- Databases and migrations; runtime env vars and secrets the code reads (names only).
- Run `node .factory/check-stack.mjs`: where `.factory/stack.json` and the code disagree. Detection only knows the registry's rules; settle each finding with the developer (declare it, drop it, or `ignore` it with the reason), and put stacks the registry lacks under `described`.
- `README.md`, and the existing `AGENTS.md` / `CLAUDE.md` (and `.cursorrules` or similar from other agents: fold what still holds into the instructions).

## 2. Hosting

- **The delivery preset decides what's needed** (`get_item` → `delivery`). *Releases* and *Merge only* need no hosting: check the release workflow (Releases) and skip the rest of this section. If what the repo does doesn't fit the preset (a repo that deploys but was imported as Merge only, say), ask the developer; the preset changes on the factory's setup page.
- **Already deployed** (a workflow deploys it, or it is clearly hosted somewhere): keep it. Make sure the preset's branches deploy (`develop` and `main` in Dev and prod, `main` in Straight to prod) and the deploying job sets the environment names. In Dev and prod, if `develop` has no deploy, ask whether to add a dev deployment on the same platform.
- **Not deployed**: Cloudflare Workers is the default, and the only platform the factory provisions. It fits static sites and SPAs (static assets), Workers-compatible SSR (TanStack Start, Astro, React Router, Hono, Next.js through OpenNext) and APIs; a SQL database becomes D1 (SQLite).
- **Doesn't fit Workers** (long-running servers, native dependencies, a database D1 can't replace): ask with options. Port to Workers; deploy elsewhere (you write the workflow; the factory only reads the environment names); or no deploys yet, only check.sh and PR CI.
- **Runtime secrets**: list the names the app needs. Never invent values: the developer adds them (`wrangler secret put`, or Actions secrets), so use `request_attention` when one is missing.

## 3. Questions and spec

Grill with `ask_questions` as `write-spec` describes, about what the facts can't settle: the hosting choice, slow or flaky checks, custom domains, whether existing CI is replaced or kept next to the `check` job. Then write the spec with `write-spec`, one slice per gap from the project standard: check.sh (including `node .factory/check-stack.mjs`), PR CI, hosting, URLs, the declared stack, instructions, the formatter's ignore file (when the repo has a formatter). Hosting on Cloudflare follows the standard's last section. The **last slice is always "Contribute to the stack registry"** (step 4), with the AC: `propose_stack_change` returned a pull request, linked in the item's PR, or the ledger says why there was nothing to propose. It goes in the spec because implementation runs in a later session that only has the spec.

## 4. Contribute what the repo knows

A repo that already runs in production knows things about its stack the registry may not. While gathering facts, note what its `CLAUDE.md`, `.cursorrules` and history teach that would hold in **any** repo with the same stack (not this project's own conventions): platform limits, framework traps, migration procedures. Compare with `docs/agents/stack.md` (`get_stack(id)` for the registry's files) and list the differences in the spec's last slice, with the source of each. Stacks described in words on the setup page (stack.md lists them) become new `experimental` options, as `bootstrap` describes. Implementing the slice means `propose_stack_change(N, summary, files)` with corrected guidelines, a new skill, or a new option; the developer reviews it as a pull request on the factory.
