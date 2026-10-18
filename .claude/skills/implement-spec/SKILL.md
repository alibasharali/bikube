---
name: implement-spec
description: Implement an approved item spec slice by slice through fresh subagents, review each slice, then verify every acceptance criterion against the running app. Use when a spec in docs/specs/ has status approved, or the user asks to implement or continue implementing an item.
---

# Implement spec

You are the **orchestrator**. You write no production code yourself. A fresh `slice-implementer` builds each slice, a `slice-reviewer` checks it, and a `verifier` checks the result on the running app. You hold the spec, the ledger and the developer's rulings; you are the only one who talks to the developer, and **the only one who commits**.

Why: one item in one context degrades toward the end. Fresh workers get a precise brief and nothing else; you stay small enough to think.

## 0. Preconditions

- You are on `claude/<n>-*`.
- The spec says `status: approved`. Otherwise stop and hand back to the gate in the `item` skill: approval is the developer's call.
- Ledger `docs/specs/<n>-<slug>/progress.md`: if it exists, resume from the first slice not `done`. If not, create it from [ledger-template.md](ledger-template.md), one row per slice, `todo`.

**Ready tree:** before the first slice, run the project's dependency install yourself, in the foreground (see `docs/agents/stack.md`; e.g. `npm ci`), and read its exit status and output. If a postinstall step failed (a blocked download, a native module), fix it (e.g. `npm rebuild <pkg>`) or ask the developer. Workers get a ready tree and must not reinstall. Never wait on a process with `pgrep -f` or `ps | grep` (it matches the waiting shell itself) and never background-then-wait; use exit statuses or result files.

Call `update_item_status(N, "in_progress")` if the item isn't there yet.

**Background workers:** the harness may run any dispatched worker (`slice-implementer`, `slice-reviewer`, `verifier`) in the background, whatever you asked for. When one comes back running, end your turn with one line saying what you're waiting for (e.g. "Waiting for the S2 implementer."), and don't touch the tree or git until that worker's report arrives: it wakes you.

A slice that is only factory tool calls (`set_environment_urls`, `create_item`, `propose_stack_change`) needs no implementer or reviewer: make the calls yourself, record the result in the ledger, and commit the ledger.

**Stack changes** (the spec's section of that name): in the slice that adds or removes the dependency, include the new `.factory/stack.json` in the brief. After the slice, call `render_stack_files(N, stack_json)` yourself, write the files it returns, delete what the old `.claude/stack-files` listed and the new one doesn't, and commit them with the slice. `.factory/check-stack.mjs` must pass.

## 1. Each slice, in spec order, one at a time

1. **Fleet.** Call `get_item(N)` again. If `fleet.you.baseTouched` is non-empty, the base branch changed your files: `git fetch origin <base> && git merge origin/<base>`, resolve any conflict, and push. When the slice's plan changes files other items touch (a rename, a schema change, a moved module), `post_note(N, text, paths)` with what changes. Plan around overlaps; never ask the developer about one.
2. `BASE=$(git rev-parse HEAD)`. Set the slice to `running` in the ledger and `report_progress(N, "Slice <k>/<total>: <slice name>")`.
3. **Brief** a `slice-implementer`. It sees nothing but the brief:
   - **Objective:** the slice text, every AC it satisfies, and the domain decisions those ACs rest on, all verbatim.
   - **Sources:** the spec path, the *Test seams* rows for these ACs, the ledger's *Interfaces* from earlier slices, rulings that touch this slice.
   - **Boundaries:** the spec's *Out of scope*, other slices' ACs ("not yours").
   - **Output:** the report shape from its definition. Tell it not to commit.
4. **BLOCKED:** don't answer for the developer. Ask them with `ask_questions` (the worker's options, your recommendation, notes on where the slice stands) and hand over as `write-spec` describes (under full auto the round comes back answered with your recommendation unless it is `for_developer`: record the ruling and carry on); the answers come back here (`record_answers`) or in a new session that resumes from the ledger. Record the ruling in the ledger. If it changes the spec, commit `docs(spec): …` first. Resume the **same** implementer with the ruling verbatim.
5. **DONE:** compare `git status` with the reported *Changed files*: nothing outside the slice, no scratch files. Put back with `git checkout -- <path>` any change to a file the slice may not edit (a formatter's rewrite of kit files, `.github/workflows/`, `.claude/`) rather than committing it. Commit `feat(<area>): S<n> <slice name> (#<n>)`. Record `BASE..HEAD` and the *Interfaces* in the ledger. Brief a `slice-reviewer` with the spec path, slice, ACs, seams and range.
6. **Route the review:**
   - `CLEAN` → step 7.
   - `FIX` → resume the same implementer with the findings verbatim, commit `fix(review): <what>`, re-review the new range. At most two rounds; what's left becomes a question for the developer.
   - `HUMAN` → ask the developer with the reviewer's options, record the ruling, and send any code change to the implementer as a fix round.
7. Set the slice to `done`, commit the ledger `docs(ledger): S<n> done (#<n>)`, and push. Pushing after each slice means a restarted session loses nothing.

If the spec turns out wrong or incomplete, stop and ask the developer. The spec is corrected first, in its own commit, then the code follows. They must never disagree.

## 2. Full checks

`report_progress(N, "Full checks")`, then run `.claude/check.sh` yourself. A red result goes back to a `slice-implementer` as a fix brief, never to you.

## 3. Verify

Green checks are not verification. Brief the `verifier` with the spec path and the *Test seams and verification* table.

- `ALL PASS` → keep its summary for the PR, and `post_verification(N, summary)`.
- `FAILED` → each failed AC is a bug: brief a `slice-implementer` with the AC and what the verifier saw, review the fix, then re-verify the failed ACs only.
- `BLOCKED` → fix the environment (install, start the app) and re-dispatch. If the app genuinely can't run in this sandbox, verify what you can through tests and say plainly in the summary which ACs were not checked on a running app.

Done when every AC has a verdict. Next is `ship`.
