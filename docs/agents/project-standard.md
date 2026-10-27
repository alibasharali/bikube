# Project standard

What a repo needs so the factory's board, checks and deploys work for it, whatever its stack. Managed by Software Factory's agent kit; don't edit this file here. The `bootstrap` (new projects) and `onboard` (imported repos) skills work from it.

## The target

What every factory project has, whatever its stack. Each item that sets a repo up (`bootstrap`, `onboard`) turns the ones the repo lacks into acceptance criteria, and says under Context which it already meets.

1. **`.claude/check.sh`**: executable, exits non-zero on failure, runs the checks that matter here (lint, typecheck, tests, build) and is fast enough for every PR and the Stop hook. It also runs `node .factory/check-stack.mjs`.
2. **PR CI**: a workflow on `pull_request` with a job whose id is `check` that runs `.claude/check.sh`. The factory's Merge button waits for the `check` status.
3. **Delivery that the board can follow**, per the project's preset (`get_item` → `delivery`, see `workflow.md`). Nobody deploys or publishes by hand.
   - *Dev and prod*: a push to `develop` deploys dev, a push to `main` deploys prod, and the deploying job sets `environment: dev` or `environment: prod` (`${{ github.ref_name == 'main' && 'prod' || 'dev' }}`).
   - *Straight to prod*: a push to `main` deploys prod, in a job with `environment: prod`.
   - *Releases*: publishing a GitHub release runs a workflow that builds and attaches what ships (installers, packages); signing secrets are the developer's.
   - *Merge only*: nothing beyond PR CI.
4. **URLs on the board** (presets that deploy): `set_environment_urls(N, dev_url, prod_url)` once they are known, `null` for an environment the preset doesn't have.
5. **Declared stack**: `.factory/stack.json` lists the stack the code uses (registry option ids, stacks the registry lacks under `described`, and under `ignore`, with a reason, options detection gets wrong here). It is the source of truth: the factory syncs its record from it on every merge into the base branch, and `.factory/check-stack.mjs` (kit-managed, rules in `.factory/detect.json`) fails when it and the code disagree. Change it in the same PR as the code, with the files `render_stack_files(N, stack_json)` returns.
6. **Instructions** tell an agent how to work here: commands, architecture in a few lines, conventions and traps. New repos keep them in `AGENTS.md` (read by every coding agent) with `CLAUDE.md` importing it; a repo whose `CLAUDE.md` already holds them keeps it there. Add to the existing file; never replace what is there.
7. **Formatters leave the kit alone**: a repo-wide formatter (`prettier --write .`, `biome format`, …) ignores the kit-managed files, which the next Update kit would overwrite anyway. For prettier, `.prettierignore` lists `.claude/`, `.factory/check-stack.mjs`, `.github/workflows/claude*.yml`, `.mcp.json` and `docs/agents/`.
8. **README**: a factory-made README (the `readme` skill): it starts with `<!-- software-factory:readme -->`, says what the project is, where it runs and how to run it locally, and ends with a *Built with Software Factory* section.
9. **Local env example**: a repo whose app reads a local env file (`.dev.vars`, `.env`) commits an example of it next to it (`.dev.vars.example`, `.env.example`) holding no secrets, with the app's mock switches (in-memory fakes of external services) on where it has them, and gitignores the real file. Agents create the real file from it with `.claude/local-env.sh` (kit-managed) before running the app.

## Reference: the TanStack Start recipe

What the factory's tested recipe (TanStack Start on Workers with D1) ships. Match their role, not their stack.

`.claude/check.sh`:

```bash
#!/usr/bin/env bash
# Everything that must be green before an agent finishes, a reviewer approves, or CI passes.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --no-audit --no-fund
npm test --silent
npm run build --silent >/dev/null
npm run typecheck --silent
node .factory/check-stack.mjs
echo "check: all green"
```

The PR workflow, `.github/workflows/ci.yml` (the import may have added `pr-check.yml` instead; one is enough):

```yaml
name: CI
on:
  pull_request:
  workflow_dispatch:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  # the job id is the required status check; don't rename it
  check:
    # Update kit PRs (factory/kit-v* from this repo; not forks, not the import PR) change
    # only kit files, so this job skips; skipped still reports "check", which required checks accept
    if: "${{ !(startsWith(github.head_ref, 'factory/kit-v') && github.event.pull_request.head.repo.full_name == github.repository && !startsWith(github.event.pull_request.title, 'chore: import into Software Factory')) }}"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: .claude/check.sh
```

The instructions (`AGENTS.md`), in this order: one line on what the project is, plus "read `docs/agents/workflow.md` before starting on an item"; **Commands** (dev server, `.claude/check.sh`, tests, migrations); "Never deploy by hand", saying which branch deploys where; traps an agent would hit (generated files, config quirks); **Architecture** in a few bullets (frameworks, where data access lives, external services such as Supabase and which environment uses which).

## Hosting on Cloudflare

After the developer approved a spec that hosts the app on Cloudflare Workers:

1. `provision_hosting(N, databases)`, with `databases` true when the app needs D1. It returns the Worker names (`<project>` and `<project>-dev`), their workers.dev URLs and the D1 ids. It is idempotent.
2. The wrangler config: the prod Worker at top level and `env.dev` with the dev Worker's name. With D1, a `d1_databases` binding `DB` holding the prod id at top level and the dev id under `env.dev`.
3. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already Actions secrets. If the repo had its own before the import, they were kept and may point at another Cloudflare account than the D1 databases: ask the developer which account to use before the first deploy.
4. The deploy workflow (adapt the build to the framework):

   ```yaml
   name: Deploy
   on:
     push:
       branches: [main, develop]
     workflow_dispatch:
   concurrency:
     group: deploy-${{ github.ref_name }}
     cancel-in-progress: false
   jobs:
     deploy:
       runs-on: ubuntu-latest
       # the factory moves items to On dev / In prod from these environment names
   # (Straight to prod: drop develop from branches; every run is prod)
       environment: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}
       env:
         CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
         CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
         # '' is falsy in expressions, so it must be the fallback, never the && branch
         WRANGLER_ENV: ${{ github.ref_name != 'main' && '--env dev' || '' }}
       steps:
         - uses: actions/checkout@v5
         - uses: actions/setup-node@v5
           with:
             node-version: 24
             cache: npm
         - run: npm ci
         - run: .claude/check.sh
         # only with D1; before the deploy, since new code may read new tables
         - run: npx wrangler d1 migrations apply DB --remote $WRANGLER_ENV
         - run: npx wrangler deploy $WRANGLER_ENV
   ```

5. Call `set_environment_urls(N, dev_url, prod_url)` with the workers.dev URLs before `ship` (`null` for dev in Straight to prod). They serve once the PR merges and the base branch deploys; in Dev and prod, prod follows the next release.
