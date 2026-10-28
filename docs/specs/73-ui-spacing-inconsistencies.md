---
item: 73
type: bug
title: UI interface inconsistencies
status: draft
branch: claude/73-ui-spacing-inconsistencies
---

# UI interface inconsistencies

## Problem

Two places put a line of text flush against the next element, which reads as a layout mistake:

- The New card dialog ([image 1]): the `Add to <column>` hint sits on the `Title` label with no space between them. `.new-card-column` sets `margin-bottom: var(--space-3)`, but `.modal-hint { margin: 0 }` has the same specificity and comes later in `main.css`, so it wins. The Edit description dialog uses the same two classes for its card title line and has the same gap of 0.
- Agent setup's Sandbox section with no `sandbox` settings ([image 2]): `No sandbox settings. …` (`.agent-setup-empty`, `margin: 0`) touches the facts card under it, since `.agent-setup-groups` puts no space between its children.

The item also asks why the `ux-reviewer` didn't catch these: its DOM measurements check overlaps, clipping and horizontal misalignment, never the vertical space between stacked siblings, and it classes inconsistent spacing as polish only. That is a kit change (the agent file is overwritten by kit updates), sent to the factory with `kit_feedback`.

## Fix

- **F1:** the hint keeps its margin under `.modal-hint`: the rule becomes `.modal-hint.new-card-column`, so both dialogs get 12 px (`--space-3`, the gap between fields) between the hint and the first field.
- **F2:** a section's own empty line directly inside `.agent-setup-groups` and followed by content gets `margin-bottom: var(--space-3)`, the space a group heading leaves above its rows.

## Acceptance criteria

- **AC1:** In the New card dialog, the vertical gap between the `Add to <column>` hint's box and the `Title` label's box is 12 px; in the Edit description dialog, the gap between the card title line and the Description field is 12 px.
- **AC2:** In Agent setup's Sandbox section with no `sandbox` settings, the gap between the `No sandbox settings.` line and the facts card is 12 px.
- **AC3:** Nothing else moves: the dialogs' other gaps and the other Agent setup sections are unchanged.

## Slices

1. **S1 – Spacing:** F1 and F2 in `src/renderer/src/assets/main.css`; the gaps asserted in `e2e/cards.spec.ts` (New card, Edit description) and `e2e/agent-setup.spec.ts` (Sandbox's empty state). Satisfies AC1–AC3.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e: bounding boxes of the hint and the label/field | Open New card and Edit description…, measure the gap |
| AC2 | e2e: bounding boxes of the empty line and `.agent-setup-facts` | Open Agent setup › Sandbox with no settings, measure |
| AC3 | the existing smoke tests | Screenshot both dialogs and Sandbox, light and dark |

## Stack changes

None.
