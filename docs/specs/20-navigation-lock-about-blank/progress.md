# Progress #20 Navigation lock misses about:blank

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `f689028..HEAD` | fresh-context review: no blocking findings; untested vectors added (location.replace, window.open _self) | none |

## Rulings

- Full auto: main can't cancel `about:blank` (neither `will-navigate` nor `will-frame-navigate` fires for it, and `webContents.stop()` in `did-start-navigation` is too late or closes the page), so the preload cancels it with the Navigation API's `navigate` event in its isolated world. Only `about:` destinations are cancelled there, so every other navigation still reaches main's lock and the tests exercise it.

## Verification

- done: lifecycle navigation tests red without the preload change (`about:blank` committed), green with it; `.claude/check.sh` green; `xvfb-run -a npm run test:smoke` 164 passed.
