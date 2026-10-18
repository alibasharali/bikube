---
name: ship
description: Ship a finished item branch: review it in a fresh context, run the retro, push, and open the PR into the base branch through the factory. Use when an item's implementation and verification are done, or the user says "ship", "open a PR" or "create the PR".
---

# Ship

## 1. Preconditions

- You are on `claude/<n>-*`, never on the base branch (`get_item`'s `delivery.baseBranch`) or `main`.
- The working tree is clean.
- The ledger's *Verification* is `done`. If not, go back to `implement-spec` step 3.

## 2. Checks

Call `get_item(N)` and re-check `fleet`. If `fleet.you.baseTouched` is non-empty, the base branch changed your files since you branched: `git fetch origin <base> && git merge origin/<base>`, resolve any conflict, and push. Overlaps with other items don't stop the PR; never ask the developer about one.

Run `.claude/check.sh`. Red sends you back to fixing, never forward.

## 3. Review in a fresh context

Dispatch a general-purpose subagent to review `git diff origin/<base>...HEAD` against the spec, `CLAUDE.md`, `.claude/rules/` and `docs/agents/review-policy.md`. It reports findings only: correctness, missing or untested ACs, scope creep, security, convention breaches. No style, no praise.

Classify every finding with the review policy:

- **Auto-fix:** fix it (through a `slice-implementer` if it's code), commit `fix(review): <what>`, rerun the checks.
- **Needs a human:** ask the developer with your recommended fix, and do what they decide.
- Judgement calls you leave in place go in the PR under *Trade-offs*, one line each on why.

Done when no finding is open.

## 4. Retro

Look back over the item: this session, the branch's commits, and the ledger's rulings and review outcomes. Collect every **correction**: where the developer corrected you or had to explain something, where you searched long for something that should be written down, a mistake a hook or check caught.

Run the `lesson` skill on each one that doesn't already have a `chore(lesson)` commit. Done when each is a `chore(lesson)` commit, a `kit_feedback` call, or judged a one-off with the reason.

## 5. Open the PR

1. `git push -u origin HEAD`.
2. Fill in [pr-template.md](pr-template.md) and call `open_pull_request(N, branch, title, body)` with title `<type>: <item title> (#<n>)`. The factory opens the PR into the base branch, turns on auto-merge where the preset and GitHub allow it, and moves the item to *In review*. When full auto decided anything on the item (answered rounds, a promotion, its approval), the factory appends a *Decided by full auto* section to the body itself: don't write one. Where the preset makes the merge ship (Straight to prod, Merge only), the developer merges; the tool's `next` says so.
3. If the tool fails, give the developer the branch and the PR body, and ask them to open it.

## 6. Hand over

Give the developer the PR link and one line on what to test on dev after it merges. CI, the Claude review and the merge are tracked by the factory. You never merge.
