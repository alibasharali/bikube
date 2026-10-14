# Progress #10 Themes and settings

Ledger for the orchestrator. Survives compaction and session restarts: the `item` skill resumes from here. Commit with each slice.

## Slices

| Slice | Status | Commits | Review | Interfaces for later slices |
|---|---|---|---|---|
| S1 | done | `0d4632e..44fc450` | CLEAN | `src/core/settings.ts`: `Settings`, `Theme`, `ResolvedTheme`, `DEFAULT_SETTINGS`, `DEFAULT_FONT_FAMILY`, `MIN_FONT_SIZE`/`MAX_FONT_SIZE`, `isTheme`, `isFontSize`, `normalizeFontFamily(v): string\|null` (empty → default), `validateSettings`, `parseSettingsFile`, `serializeSettings`, `resolveTheme(theme, osPrefersDark)`, `THEME_BACKGROUNDS`; `window.drovr.settings.load()/save(settings)` (IPC `settingsLoad`/`settingsSave`); renderer `src/renderer/src/settings.ts`: `settingsStore.get()/update(partial): boolean/subscribe(fn)`, `useSettings()`, `createSettingsStore(initial, save)`; fontFamily always the effective family (dialog shows '' when default); `e2e/settings.spec.ts` exists (emulate colour scheme: xvfb resolves to light) |
| S2 | done | `18212fc..1de888d` | fixed r1 (e2e proves saved theme) | `isSettingsShortcut(event, platform)` in core/card-shortcuts.ts; `src/core/settings-form.ts`: `parseFontSize(text)`, `fontFamilyField(family)`, `FONT_SIZE_ERROR`; `SettingsDialog.tsx`; test ids `settings-open`, `settings-dialog`, `settings-theme-{system,dark,light}`, `settings-font-size`, `settings-error-font-size`, `settings-font-family`, `settings-done`; e2e helpers `followNativeTheme(page)` (Playwright pins light scheme otherwise), `alphaWithApi`, `bufferLines`, `boardColours`, `expectSettingsFile`, `SHORTCUT` |
| S3 | done | `0bd0aa8..81976d8` | ruling r1 (light white/brightWhite) | `src/core/terminal-appearance.ts`: `TERMINAL_PALETTES`, `terminalAppearance(settings, osPrefersDark)`; `XtermScreen.applyAppearance` |

## Rulings

Decisions the developer made during implementation, with the date. A ruling that changes the spec also got its own `docs(spec):` commit.

- 2026-10-14 S3 (full auto, round 2): light terminal palette's ANSI white/brightWhite → darken white (~#6e7781) and give brightWhite its own value, both ≥ ~3:1 on white; the test covers every colour. Within D3's wording; no spec change.
- 2026-10-14 ship review (full auto, round 3): Q1 apply the font family on every close (Done/Escape/outside); Q2 family field maxLength 200; Q3 size stays a text field, AC5 starts from the default window width. Spec D5, AC5, AC6 updated.

## Verification

- done (ALL PASS)
