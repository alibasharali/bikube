---
item: 20
type: bug
title: Navigation lock misses about:blank (and data: test doesn't exercise it)
status: approved
branch: claude/20-navigation-lock-about-blank
---

# Navigation lock misses about:blank

## Problem

The navigation lock in `src/main/index.ts` cancels `will-navigate`, but a renderer `location.href = 'about:blank'` never fires `will-navigate` and actually leaves the page. Since #4, main kills every shell of a page on a committed main-frame `did-navigate` (`src/main/terminals.ts`), so such a navigation also ends every card's shell. The e2e test "the page cannot navigate away or open windows" in `e2e/lifecycle.spec.ts` uses a `data:` URL, which Chromium blocks before any navigation event, so it never reaches the lock. Parent: #4.

## Acceptance criteria

- **AC1 – about:blank is blocked:** Given the app with a running shell, when the page runs `location.href = 'about:blank'`, then the page URL is unchanged, the app is still shown and the shell is still alive. (e2e `e2e/lifecycle.spec.ts`.)
- **AC2 – The lock is exercised:** Given the app with a running shell, when the page navigates to `file:///tmp/` and to `https://example.com/`, then the page URL is unchanged, the app is still shown and the shell is still alive; `window.open` still returns `null` and opens no window. (e2e `e2e/lifecycle.spec.ts`.)
- **AC3 – Reload still kills:** `page.reload()` still ends the page's shells (existing test "reloading the page kills its shells" stays green).

## Slices

1. **S1 – Lock every main-frame navigation:** the lock also cancels navigations `will-navigate` misses (about:blank), and the lifecycle test navigates to about:blank, `file:///tmp/` and `https://example.com/` with a live shell. Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1–AC3 | e2e `e2e/lifecycle.spec.ts` | `xvfb-run -a npm run test:smoke` |

## Stack changes

None.

## Data and migrations

None.

## Out of scope

- Changes to how `did-navigate` kills shells.
- Subframe navigation (the app has no iframes).

## Open questions

None.
