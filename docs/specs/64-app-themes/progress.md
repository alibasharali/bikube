# Progress #64 App Themes

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | 1801036..05ebe51 | CLEAN (2 fix rounds: kind/running stylesheet test; Nord borders palette-only, border-strong = border) | src/core/app-themes.ts: APP_THEME_IDS, AppThemeId, DEFAULT_APP_THEME, isAppThemeId, APP_THEME_TOKENS, AppThemeTokens, APP_THEMES, appTheme(id), appThemeTokens(id, version), windowBackground(id, version), appThemeDeclarations(tokens); src/core/contrast.ts; Settings.appTheme; new tokens running, switch-knob, kind-*; [data-kind] reads --kind-* from :root |
| S2 | done | 4ca51d2..de4aa2e | CLEAN | settingsStore.update({ appTheme }) applies live in every window and saves; <style data-app-theme> per document (:root:root, light under prefers-color-scheme); themeDocument(doc) for card windows; launch arg via appThemeArg/parseAppThemeArg; e2e helpers e2e/app-theme.ts setAppTheme(page,id) (test hook window.__bikubeSettings.update, --bikube-test-hooks), bodyBackground(page) |
| S3 | done | 0915377..c86f6bd | CLEAN | AppThemePicker.tsx; tiles data-testid app-theme-<id>, .app-theme-preview; e2e/app-theme.ts pickAppTheme(page,name), bodyBackground(page); test hook removed |
| S4 | running | | | |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-23 (round 2 Q1): Default light's running green is `#1a7f37`; dark keeps `#3fb950`.
- 2026-10-23 (round 2 Q2): Default dark's danger text (`#ffffff` on `#e5484d`, 3.91:1) stays; it is the contrast test's one named exception.

## Verification

- todo
- UX review: todo
