# Progress #64 App Themes

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | 1801036..05ebe51 | CLEAN (2 fix rounds: kind/running stylesheet test; Nord borders palette-only, border-strong = border) | src/core/app-themes.ts: APP_THEME_IDS, AppThemeId, DEFAULT_APP_THEME, isAppThemeId, APP_THEME_TOKENS, AppThemeTokens, APP_THEMES, appTheme(id), appThemeTokens(id, version), windowBackground(id, version), appThemeDeclarations(tokens); src/core/contrast.ts; Settings.appTheme; new tokens running, switch-knob, kind-*; [data-kind] reads --kind-* from :root |
| S2 | done | 4ca51d2..de4aa2e | CLEAN | settingsStore.update({ appTheme }) applies live in every window and saves; <style data-app-theme> per document (:root:root, light under prefers-color-scheme); themeDocument(doc) for card windows; launch arg via appThemeArg/parseAppThemeArg; e2e helpers e2e/app-theme.ts setAppTheme(page,id) (test hook window.__bikubeSettings.update, --bikube-test-hooks), bodyBackground(page) |
| S3 | done | 0915377..c86f6bd | CLEAN | AppThemePicker.tsx; tiles data-testid app-theme-<id>, .app-theme-preview; e2e/app-theme.ts pickAppTheme(page,name), bodyBackground(page); test hook removed |
| S4 | done | 95c297f..4f1aeb5 | CLEAN | PaletteInput.appTheme; palette action {id:"appTheme", appTheme} run as settingsStore.update |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-23 (round 2 Q1): Default light's running green is `#1a7f37`; dark keeps `#3fb950`.
- 2026-10-23 (round 2 Q2): Default dark's danger text (`#ffffff` on `#e5484d`, 3.91:1) stays; it is the contrast test's one named exception.

- 2026-10-23 (round 3 Q1): D5 extended: danger as text 4.5:1 on bg, card, surface and raised surface; failing themes get a nearby red (D4); Default dark a named exception (spec 38a5b50).
- 2026-10-23 (round 3 Q2): D5 extended: muted text 4.5:1 on --chip; failing themes adjust muted or chip within their palette.
- 2026-10-23 (round 3 Q3): D8 extended, AC8b added: every Settings row stacks its label above its control in a narrow dialog.
- 2026-10-23: full smoke run found AC5 flaky (theme applied after first paint, a real flash); fixed in 157d7d3..0726c66 by inserting the style from the preload.

## Verification

- done: ALL PASS (AC10's packaged part left to CI's test:packaged; smoke: 2 known root failures + moves.spec AC9 load flake passing on rerun)
- UX review: 3 must-fix (danger as text on surfaces in palette themes; muted text on --chip; Settings at 320-480 px squeezes the App theme grid, pre-existing for the Theme row): asked round 3; answered, fix round 1 running
