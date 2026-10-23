---
item: 64
type: feature
title: App Themes
status: approved
branch: claude/64-app-themes
---

# App Themes

## Problem

Bikube's own chrome (board, sidebar, side panel, title bar, menus, command palette, Settings and the other dialogs, card windows) has one look in a dark and a light version, while terminals already pick from hundreds of colour themes. Users who live in Catppuccin, Rosé Pine, Nord or Gruvbox see the app clash with their terminals, and the app has no look of its own from its logo. After this item, Settings offers six app themes, each with a dark and a light version; the existing Theme setting (System / Dark / Light) keeps picking the version, and terminals keep their own theme settings.

## Domain decisions

- **D1 – App theme, separate from Theme:** a new setting, **App theme**, picks the palette of the app's chrome; the existing **Theme** setting (System / Dark / Light) keeps picking which version of it shows, so System still follows the OS. The two are independent: any app theme with any Theme. *Why:* the item; one axis each keeps System working for every palette.
- **D2 – The six themes:** each has a dark and a light version.
  | App theme | Dark | Light |
  |---|---|---|
  | Default | today's dark palette, unchanged | today's light palette, unchanged |
  | Bikube | warm near-black `#17140F` background, honey accent `#F5B82E` | warm cream background, dark amber accent, black text |
  | Catppuccin | Mocha | Latte |
  | Rosé Pine | Main | Dawn |
  | Nord | Polar Night backgrounds, Snow Storm text, Frost accent | Snow Storm backgrounds, Polar Night text, Frost accent |
  | Gruvbox | dark (bg0 `#282828`) | light (bg0 `#fbf1c7`) |

  Every colour of a palette theme (Catppuccin, Rosé Pine, Nord, Gruvbox) comes from that theme's published palette, except where D5 forces an adjustment; shadows and the dialog backdrop may be tuned per version. Default is the default for new installs and for every existing settings file. *Why:* the item; Default must not change for anyone who never opens the picker.
- **D3 – What a theme colours:** every colour token of the app's chrome: backgrounds and surfaces (board, columns, cards, chips, sidebar, side panel, title bar, menus, palette, dialogs, inputs, segmented controls), borders, text and muted text, the accent and its soft tint, the focus ring (the accent), danger, the dialog backdrop, shadows, the three activity pills (Working, Waiting for you, Needs your answer), the running dot and a trigger's done mark (today a hard-coded green, made a token), and the toggle knob. The terminal area does not: terminal colours, the pane background behind a terminal, Find's amber highlight and the failed-command decorations stay as they are (#45, #35). *Why:* the item keeps terminal theming independent; the pane's background belongs to the terminal.
- **D4 – Agent logo and status colours:** the agent logo colours (Claude, Codex, Gemini, OpenCode, Custom: the `--kind` colours in the sidebar tree and on board cards) and the danger and running colours keep today's values in every theme (dark ones under dark versions, light ones under light), except where one fails D5's contrast on that theme's card or sidebar background; then that theme's version gets a nearby shade of the same hue that passes. The running green is a new token: dark versions keep `#3fb950`, and Default light uses `#1a7f37` (today's `#3fb950` is 2.54:1 on its white cards). *Why:* developer's answers (Q5; round 2 Q1): brand colours stay recognisable; only unreadable ones move.
- **D5 – Readable in every version:** for each of the 12 theme versions: text and muted text at least 4.5:1 on the background, column, card, surface and raised surface; the accent (focus ring) at least 3:1 on the background, card and surface; the accent's text at least 4.5:1 on the accent; danger text at least 4.5:1 on danger; each activity pill's text at least 4.5:1 on its pill background composited over the card; each `--kind` colour and the running green at least 3:1 on the card and the surface. A Vitest checks every one of these for every version. One named exception: Default dark's danger text (`#ffffff` on `#e5484d`, 3.91:1) stays as it is today, listed by name in the test; every other version's danger text must pass. *Why:* developer's answer (round 2 Q2) keeps Default unchanged; the item asks for readable text, focus rings, pills and logo colours in every theme; a table makes it testable.
- **D6 – Bikube's pills:** Working in honey, Waiting for you in a warm green, Needs your answer in deep orange, in both versions (darker shades in light). *Why:* developer's answer (Q4): all warm, still told apart by colour.
- **D7 – Where it applies:** the theme shows in the main window and every card window (#53), changes live in all of them the moment it is picked (no reload, terminals keep running and keep their content), and is applied before the first paint at launch, so no window shows Default's colours first. Main creates the main window and each card window with the picked theme's background for the resolved version (the existing `backgroundColor`, now per theme), so a launch never flashes another colour. *Why:* the item's notes; card windows copy the app's stylesheets once, so the live change must reach them separately.
- **D8 – The picker:** Settings' Appearance section gets an **App theme** row under the Theme row: a grid of six tiles, one per theme in D2's order, each a small preview with the theme's name under it; clicking a tile applies the theme at once and saves it (as every Settings control does). Each tile previews the version the window shows now (dark or light): a mini sidebar, a column holding a card, the accent, and the three activity pills, drawn in that theme's colours. The tiles are one radio group: the current theme's tile is checked and marked (accent outline), arrow keys move between tiles and pick, Tab enters and leaves the group, each tile's accessible name is the theme's name. The grid wraps to fewer columns when the dialog is narrow. *Why:* developer's answers (Q1, Q2).
- **D9 – Palette rows:** the command palette lists `App theme: <name>` for every app theme but the current one, beside the existing `Theme:` rows, matched like any row; Enter applies and saves it as the picker does. *Why:* developer's answer (Q3); mirrors the Theme rows.
- **D10 – Saved:** `bikube-settings.json` gets `appTheme` with one of `default`, `bikube`, `catppuccin`, `rose-pine`, `nord`, `gruvbox`, written only when it isn't `default` (the Preferences table's rule). Missing reads Default; an unknown or invalid value reads Default as other invalid preferences do. Not in the state file or the Sync folder: like Theme, it is this machine's. *Why:* the item.
- **D11 – Credits:** `THIRD_PARTY_NOTICES` credits the Catppuccin, Rosé Pine, Nord and Gruvbox palettes with their MIT licence texts. *Why:* the item; the file is already packaged.

## Acceptance criteria

- **AC1 – Theme table and contrast:** Given the app themes table, then it has exactly the six themes of D2 in that order, each with a dark and a light version holding every token of D3; Default's tokens equal the values in the app stylesheet's dark and light blocks today (a test reads the stylesheet, so they cannot drift); Bikube dark's background is `#17140F` and its accent `#F5B82E`; and every D5 ratio holds for all 12 versions but D5's one named exception (Default dark's danger text). Default light's running green, a new token with no light value today, is `#1a7f37`. (Vitest, core)
- **AC2 – Setting read and written:** Given no `appTheme` in `bikube-settings.json`, when settings load, then the app theme is Default; given `"appTheme": "nord"`, Nord; given `"appTheme": "solarized"` or `42`, Default; when the user picks Default, then the file has no `appTheme` key; when they pick Gruvbox, `"appTheme": "gruvbox"`. (Vitest, core settings)
- **AC3 – Default unchanged:** Given a fresh install, when the app opens with Theme Dark, then the board's background reads `rgb(20, 21, 26)` (`#14151a`) and the accent `#6d8dfa`, as today; with Theme Light, `#f6f7f9` and `#3d63dd`. (e2e)
- **AC4 – Picking a theme:** Given Settings open with Theme Dark, when the user clicks the Catppuccin tile, then without a reload the page's background becomes Mocha's base `#1e1e2e`, the tile is checked, and `bikube-settings.json` has `"appTheme": "catppuccin"`; when Theme is switched to Light, the background becomes Latte's base `#eff1f5` and the tiles' previews show the light versions. (e2e)
- **AC5 – Kept across a restart, no flash:** Given `"appTheme": "bikube"` and `"theme": "dark"` in `bikube-settings.json`, when the app launches, then main created the window with background `#17140F` and the page's first rendered background is `#17140F`. (e2e, main's window options read through `app.evaluate`)
- **AC6 – Card windows:** Given a card open in its own window (#53) under Default, when the user picks Nord in the main window's Settings, then the card window's chrome (its bar) takes Nord's colours at once while its terminal keeps running with unchanged terminal colours; a card window opened after that is created with Nord's background. (e2e)
- **AC7 – Terminals independent:** Given a running card with terminal theme X, when the app theme changes to Gruvbox, then the terminal's theme (xterm's `options.theme`) and the pane background are unchanged. (e2e)
- **AC8 – Picker keyboard and a11y:** Given Settings' Appearance section, when the user tabs into the App theme group and presses Right, then the next tile is checked and applied; the group has role `radiogroup` named App theme and six `radio` tiles named Default, Bikube, Catppuccin, Rosé Pine, Nord, Gruvbox. (e2e)
- **AC9 – Palette rows:** Given App theme Default, when the palette is opened and `app theme` typed, then five rows `App theme: Bikube` … `App theme: Gruvbox` show and none for Default; Enter on `App theme: Nord` applies Nord and saves it. (Vitest for the rows, e2e for Enter)
- **AC10 – Credits:** `THIRD_PARTY_NOTICES` names Catppuccin, Rosé Pine, Nord and Gruvbox with their MIT licences, and the packaged app still has the file. (check by reading the file; `e2e/packaged.spec.ts` unchanged)
- **AC11 – No regressions:** every existing Vitest and e2e test stays green.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Themes table and the setting:** the core table of six themes with dark and light token sets (D2–D6), the hard-coded running green and toggle knob made tokens, the `appTheme` preference (D10), main's window background per theme (D7's background part), the contrast and Default-equality tests. Satisfies AC1, AC2, AC5's main part.
2. **S2 – Applying the theme everywhere:** the renderer applies the picked theme's tokens to the main page before first paint and live on change, and to every card window (D7). Satisfies AC3, AC5, AC6, AC7.
3. **S3 – The picker:** the App theme tile grid with previews in Settings' Appearance section (D8). Satisfies AC4, AC8.
4. **S4 – Palette rows, credits and docs:** the `App theme:` palette rows (D9), `THIRD_PARTY_NOTICES` (D11), `CONTEXT.md`'s Settings entry and `AGENTS.md`'s settings test list. Satisfies AC9, AC10, AC11.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | Vitest, core app themes table (+ reading `main.css`) | `npm test` |
| AC2 | Vitest, `src/core/settings.test.ts` | `npm test` |
| AC3 | e2e `e2e/settings.spec.ts` | read the body's computed background and `--accent` under Dark and Light |
| AC4 | e2e `e2e/settings.spec.ts` | open Settings, click Catppuccin, read the background and the settings file; switch Theme to Light |
| AC5 | e2e `e2e/settings.spec.ts` | write the settings file, launch, read main's window background and the page's |
| AC6 | e2e `e2e/card-windows.spec.ts` | open a card window, pick Nord, read the bar's background in the card window |
| AC7 | e2e `e2e/settings.spec.ts` or `e2e/terminal-themes.spec.ts` | read the xterm theme before and after picking Gruvbox |
| AC8 | e2e `e2e/settings.spec.ts` | keyboard into the group, Right, read the checked tile and the background |
| AC9 | Vitest `src/core/palette.test.ts` + e2e `e2e/palette.spec.ts` | open the palette, type `app theme`, Enter on Nord |
| AC10 | read `THIRD_PARTY_NOTICES` | — |
| AC11 | all | `.claude/check.sh`, `xvfb-run -a npm run test:smoke` |

Theme Setting tests must call `followNativeTheme` (`page.emulateMedia({ colorScheme: null })`) as the existing Theme tests do, since Playwright pins `prefers-color-scheme: light`.

## Stack changes

None.

## Data and migrations

`bikube-settings.json` gains the optional `appTheme` (D10), written only when not `default`; existing files read Default. Nothing in the state file or the Sync folder.

## Out of scope

- User-defined or imported app themes, and editing a theme's colours.
- Deriving the app theme from the terminal theme or Ghostty's config, or the reverse.
- Changing terminal colours, the pane background, Find's highlight or the failed-command decorations.
- Changing the Theme setting (System / Dark / Light) or its palette rows.
- Per-workspace themes.

## Open questions

None.
