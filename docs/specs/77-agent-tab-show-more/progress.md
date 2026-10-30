# #77 progress

| Slice | Status |
|---|---|
| S1 – Cut lists | done |

Verification: done. AC1–AC4 checked by `e2e/agent-tab.spec.ts`'s #77 tests on the built app (xvfb). All 17 Agent tab tests pass; `check.sh` is green apart from the root-only updater test.
UX review: skipped. The only new UI is the existing `agent-tab-show-all` small button, now under What changed as well, with new labels.
Review: a 10-row boundary test was added, and Show all now resets when a new prompt starts at Last prompt (both `fix(review)`).
