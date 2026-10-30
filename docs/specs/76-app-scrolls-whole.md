---
item: 76
type: bug
title: You can scroll the whole app down
status: approved
branch: claude/76-app-scrolls-whole
---

# You can scroll the whole app down

## Problem

With the side panel's Agent tab full of rows, the mouse wheel over the sidebar scrolls the whole window: the title bar goes off the top and an empty strip opens at the bottom ([image 1]).

The cause: each Commands row's status word is `.visually-hidden` (`StatusMark`'s `quiet`), which is `position: absolute` with no offsets, so it sits at its place in the list. Its containing block was `.side-panel` (positioned), not the scrolling `.side-panel-body`, so the scroller didn't clip it and the hidden words far down a long list made the page itself taller (5,500 px in a 720 px window with 120 commands). The sidebar doesn't scroll, so its wheel went to the page, and `html`/`body` let the page scroll.

## Fix

- **F1:** `.side-panel-body` is `position: relative`, so whatever its tabs hide with `.visually-hidden` stays inside its scroll.
- **F2:** `html` and `body` are `overflow: hidden`: the window never scrolls itself, only the panes in it, whatever later overflows.

## Acceptance criteria

- **AC1:** With 120 commands in a Claude Code card's Agent tab, the page's scroll height equals its height.
- **AC2:** The wheel over the sidebar then leaves the page's scroll at 0.
- **AC3:** The side panel's tabs scroll and lay out as before.

## Slices

1. **S1 – No page scroll:** F1 and F2 in `src/renderer/src/assets/main.css`; `#76` in `e2e/agent-tab.spec.ts`. Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1, AC2 | e2e: `document.scrollingElement`'s size and `scrollTop` after `mouse.wheel` over the sidebar | Fill the Agent tab, wheel over the sidebar |
| AC3 | the existing side panel, Shells tab and Agent tab smoke tests | — |
