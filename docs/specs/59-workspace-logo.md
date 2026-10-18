---
item: 59
type: chore
title: Workspace logo
status: approved
branch: claude/59-workspace-logo
---

# Workspace logo

## Problem

Every workspace shows the same kind of sidebar badge: the first letter of its name (`workspaceInitial`). Workspaces whose names start with the same letter look alike, more so in the collapsed rail. After this ships, the Create and Edit workspace dialog has a **Logo** choice: a set of icons from lucide (`lucide-react`, the icon pack the app already uses), or none. The sidebar badge shows the picked icon in place of the letter, expanded and collapsed. The logo is saved, synced and kept across a restart like the workspace's other settings.

## Domain decisions

- **D1 – A fixed set of lucide icons:** the choices are a curated list of 24 lucide icons, each with a stable id (its kebab-case lucide name, such as `rocket`) and a label for its tooltip and accessible name. The list and its order live in one plain-TS module in `src/core` (ids and labels only, no React). The renderer maps each id to its lucide component. *Why:* the item asks for "a bunch of selections from the logo pack we are using". A fixed list keeps the picker small and keeps the saved value checkable. Uploaded images and the whole lucide set are left out.
- **D2 – None is the default:** a workspace has an optional `logo` (one of D1's ids). Absent means none, and the badge shows the initial letter as it does today. New workspaces start with none, and so do workspaces in existing state files: no migration. Like `host` (#12 D10), a workspace with no logo has no `logo` key in the saved file.
- **D3 – The picker:** the dialog gets a **Logo** fieldset below Name. It holds a grid of radio buttons: **None** first (showing the initial letter of the Name field as it reads now), then D1's icons in order. Each choice has `title` and `aria-label` set to its label, and the keyboard works as in any radio group. Picking a choice changes nothing until Save or Create. The fieldset is shown for SSH and local workspaces alike.
- **D4 – Where it shows:** only the sidebar's workspace badge (`workspace-badge`), in the expanded list and the collapsed rail, at the size the letter has now. Nothing else changes, including the title bar and the palette.
- **D5 – Reading an unknown id:** a saved or synced `logo` that is not a string fails the file as other bad fields do. A string that is not one of D1's ids (written by a newer version with more icons) reads as none and does not fail the file. *Why:* a logo is cosmetic, and an older app must not discard a whole board because of one.
- **D6 – Sync:** the logo is part of the workspace's definition and travels through the Sync folder (#13) as the name does.

## Acceptance criteria

- **AC1 – Pick on create:** Given the Create workspace dialog with a valid folder, when the user picks the `Rocket` logo and presses Create, then the new workspace's sidebar badge shows the rocket icon (`data-logo="rocket"`) in place of the letter, both expanded and with the sidebar collapsed.
- **AC2 – Change and clear on edit:** Given a workspace with the `rocket` logo, when its Edit dialog opens, then `Rocket` is the checked choice. Picking `None` and saving brings back the initial letter. Picking `Cancel` after choosing another logo leaves the badge as it was.
- **AC3 – Saved and restored:** Given a workspace with the `rocket` logo, when the app restarts, then its badge still shows the rocket icon, and the state file holds `"logo": "rocket"` for it. A workspace without a logo has no `logo` key.
- **AC4 – Reading old and unknown values:** Given a state file from before this item (no `logo`), its workspaces read with none. Given `"logo": "not-a-logo"`, the workspace reads with none and the rest of the file loads. Given `"logo": 5`, the file is rejected as with any bad field. (Vitest, `saved-state`.)
- **AC5 – Store:** `createWorkspace` and `updateWorkspace` accept a `logo` from D1's list or null (null clears it), and refuse an unknown id with an error. (Vitest, `workspace-store`.)
- **AC6 – Sync:** the sync file carries the workspace's `logo` (absent for none). (Vitest, `sync-file`.)

## Slices

1. **S1 – Logo end to end:** D1's list in core; `logo` on `Workspace`, `WorkspaceInput` and `WorkspacePatch` with the store's checks; read and written by saved state and the sync file; the dialog's Logo fieldset; the sidebar badge. Unit tests for AC4–AC6, e2e tests for AC1–AC3 in `e2e/board.spec.ts` (AC1, AC2) and `e2e/persistence.spec.ts` (AC3). AGENTS.md's test list names them. Satisfies AC1–AC6.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `e2e/board.spec.ts` | create a workspace with the Rocket logo, check the badge, collapse the sidebar, check again |
| AC2 | e2e `e2e/board.spec.ts` | edit it, check the checked choice, None and Save, Cancel |
| AC3 | e2e `e2e/persistence.spec.ts` | restart, check the badge and the state file |
| AC4 | Vitest `src/core/saved-state.test.ts` | — |
| AC5 | Vitest `src/core/workspace-store.test.ts` | — |
| AC6 | Vitest `src/core/sync-file.test.ts` | — |

## Stack changes

None: `lucide-react` is already a dependency.

## Data and migrations

A new optional `logo` string on each workspace in `drovr-state.json` and in the sync file. Existing rows have none and read as none. No migration.

## Out of scope

- Uploading an image or emoji as a logo, colours for the badge, and the whole lucide set with a search box.
- Showing the logo anywhere except the sidebar badge.

## Open questions

None.
