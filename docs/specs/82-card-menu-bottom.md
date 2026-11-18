---
item: 82
type: bug
title: Menu for cards at the bottom disappears
status: approved
branch: claude/82-card-menu-bottom
---

# Menu for cards at the bottom disappears

## Problem

A board card's ⋯ menu near the bottom of the window opens below its button and runs off the bottom of the window ([image 1]): its last items can't be seen or clicked until the card is moved up. `MenuButton`'s fixed menus (the card menu, the Shells tab's ⋯ menu) always open under the button and only move back inside the window sideways.

## Fix

- **F1:** A fixed menu (`MenuButton`'s `fixed`) is placed once it is drawn, before the paint, by `menuPlacement` (`src/core/menu-placement.ts`, Node-free, Vitest): under the button when it fits there, else above it when it fits there, else on the side with more room with its height capped to that room and its items scrolling (`overflow-y: auto`). Sideways it keeps today's rule (its `align` edge, kept inside the window), with a 4 px margin from the window's edges.

## Acceptance criteria

- **AC1:** Given a card at the bottom of a column in a short window, when its ⋯ menu opens, then the whole menu is inside the window, above the button, and its last item can be clicked.
- **AC2:** A card menu with room below still opens under its button, as before.
- **AC3:** In a window too short for the whole menu, the menu stays inside the window and scrolls to its last item.

## Slices

1. **S1 – Flip and cap fixed menus:** `menuPlacement` with Vitest cases (below, above, capped either side, sideways clamp); `MenuButton` uses it; a smoke test in `e2e/moves.spec.ts`. Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e: a short window, the last card's menu box inside the viewport and above the button, its last item clicked | Open the bottom card's ⋯ |
| AC2 | e2e: the first card's menu under its button; the existing card menu tests | Open the top card's ⋯ |
| AC3 | Vitest: the capped placement | Shrink the window, open a card's ⋯ |

## Stack changes

None.
