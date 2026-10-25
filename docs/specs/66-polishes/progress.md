# Progress #66 Polishes

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `89e95e6..ceb7b5a` | CLEAN | none |
| S2 | done | `2227020..25c71da` | CLEAN | AppearanceSection() no props, Theme + AppThemePicker; TerminalFontRows; TerminalPreview fontWeight/lineHeight/letterSpacing; AC6 e2e expects Appearance labels [Theme, App theme] (S3 adds App font) |
| S3 | done | `53c9e10..e374c00` | CLEAN | appFontFamily preference; core/app-fonts.ts; renderer app-font.ts fontDocument |
| S4 | done | `ce46f54..74cbad0` | CLEAN | WorkspaceShell.temporary; temporary-shells.ts |

## Rulings

- 2026-10-25 S1/S2 (orchestrator, chore without a gate): D8's window minimum lowered from 400×300 to 320×240 (023e067) because #64's UX test and the UX standard size the window to 320 px. Not a developer ruling; listed in the PR's Trade-offs.

## Verification

- done (ALL PASS; AC9 maximized half not checkable under xvfb)
- UX review: done (CLEAN; 3 polish)
