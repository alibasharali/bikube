/**
 * The app themes (#64): the palettes of the app's chrome, each with a dark and a light version
 * (D2), as the values of the app stylesheet's colour tokens (D3). The terminal area is not
 * themed: `--terminal-bg` and terminal colours stay with the terminal theme. Plain TS with no Node
 * or DOM imports, so main and the renderer can both use it.
 *
 * Default is the app stylesheet's own values (a test keeps them equal). The palette themes take
 * every colour from their published palettes (Catppuccin Mocha and Latte, Rosé Pine Main and
 * Dawn, Nord, Gruvbox), apart from shadows, the backdrop, the soft tints and pill backgrounds (the
 * palette's colour at an alpha), and the shades D5's contrast forced (marked below). The agent,
 * danger and running colours are today's in every theme (D4), moved only where D5 forced it.
 */

import type { ResolvedTheme } from './settings'

/** Each app theme's id as `bikube-settings.json` holds it (D10), in D2's order. */
export const APP_THEME_IDS = [
  'default',
  'bikube',
  'catppuccin',
  'rose-pine',
  'nord',
  'gruvbox'
] as const
export type AppThemeId = (typeof APP_THEME_IDS)[number]

export const DEFAULT_APP_THEME: AppThemeId = 'default'

/** The colour tokens a theme sets: the stylesheet's custom properties without the leading `--`. */
export const APP_THEME_TOKENS = [
  'bg',
  'surface',
  'surface-raised',
  'surface-hover',
  'segment-active',
  'column',
  'card',
  'card-hover',
  'chip',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'accent',
  'accent-text',
  'accent-soft',
  'danger',
  'danger-text',
  'backdrop',
  'pill-working-bg',
  'pill-working-text',
  'pill-waiting-bg',
  'pill-waiting-text',
  'pill-question-bg',
  'pill-question-text',
  'shadow-card',
  'shadow-card-hover',
  'shadow-menu',
  'shadow-dialog',
  'running',
  'switch-knob',
  'kind-claude',
  'kind-codex',
  'kind-gemini',
  'kind-opencode',
  'kind-custom'
] as const
export type AppThemeToken = (typeof APP_THEME_TOKENS)[number]
export type AppThemeTokens = Readonly<Record<AppThemeToken, string>>

export interface AppTheme {
  id: AppThemeId
  /** The name the picker and the palette show. */
  name: string
  dark: AppThemeTokens
  light: AppThemeTokens
}

/** Today's agent, danger and running colours under dark versions (D4). */
const DARK_MARKS = {
  danger: '#e5484d',
  running: '#3fb950',
  'kind-claude': '#d97757',
  'kind-codex': '#10a37f',
  'kind-gemini': '#4e8cf7',
  'kind-opencode': '#a78bfa',
  'kind-custom': '#94a3b8'
} as const

/** Today's agent and danger colours under light versions, and the light running green (D4). */
const LIGHT_MARKS = {
  danger: '#d1343a',
  running: '#1a7f37',
  'kind-claude': '#c15f3c',
  'kind-codex': '#0b7a5f',
  'kind-gemini': '#1a65d6',
  'kind-opencode': '#7c3aed',
  'kind-custom': '#5b6678'
} as const

const DARK_SHADOWS = {
  'shadow-card': '0 1px 2px rgba(0, 0, 0, 0.35)',
  'shadow-card-hover': '0 2px 8px rgba(0, 0, 0, 0.45)',
  'shadow-menu': '0 8px 24px rgba(0, 0, 0, 0.45)',
  'shadow-dialog': '0 16px 48px rgba(0, 0, 0, 0.55)'
} as const

/** Light shadows tinted with `rgb`, a theme's darkest colour as `r, g, b`. */
const lightShadows = (rgb: string): Pick<AppThemeTokens, keyof typeof DARK_SHADOWS> => ({
  'shadow-card': `0 1px 2px rgba(${rgb}, 0.06), 0 1px 3px rgba(${rgb}, 0.08)`,
  'shadow-card-hover': `0 2px 4px rgba(${rgb}, 0.08), 0 4px 12px rgba(${rgb}, 0.1)`,
  'shadow-menu': `0 8px 24px rgba(${rgb}, 0.14)`,
  'shadow-dialog': `0 16px 48px rgba(${rgb}, 0.18)`
})

const DEFAULT: AppTheme = {
  id: 'default',
  name: 'Default',
  dark: {
    bg: '#14151a',
    surface: '#1b1d24',
    'surface-raised': '#1f2129',
    'surface-hover': '#262933',
    'segment-active': '#2c303c',
    column: '#191b21',
    card: '#21232b',
    'card-hover': '#262933',
    chip: '#282b35',
    border: '#2a2d38',
    'border-strong': '#3a3e4c',
    text: '#e6e7eb',
    'text-muted': '#9094a3',
    accent: '#6d8dfa',
    'accent-text': '#0e1220',
    'accent-soft': 'rgba(109, 141, 250, 0.16)',
    'danger-text': '#ffffff',
    backdrop: 'rgba(0, 0, 0, 0.55)',
    'pill-working-bg': 'rgba(109, 141, 250, 0.18)',
    'pill-working-text': '#9fb4ff',
    'pill-waiting-bg': 'rgba(70, 167, 88, 0.2)',
    'pill-waiting-text': '#7fd18e',
    'pill-question-bg': 'rgba(255, 178, 36, 0.2)',
    'pill-question-text': '#ffc53d',
    ...DARK_SHADOWS,
    'switch-knob': '#ffffff',
    ...DARK_MARKS
  },
  light: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    'surface-hover': '#eceef2',
    'segment-active': '#ffffff',
    column: '#eef0f3',
    card: '#ffffff',
    'card-hover': '#ffffff',
    chip: '#e1e4ea',
    border: '#d9dce3',
    'border-strong': '#c3c8d2',
    text: '#1b1d24',
    'text-muted': '#5d6170',
    accent: '#3d63dd',
    'accent-text': '#ffffff',
    'accent-soft': 'rgba(61, 99, 221, 0.1)',
    'danger-text': '#ffffff',
    backdrop: 'rgba(16, 24, 40, 0.35)',
    'pill-working-bg': 'rgba(61, 99, 221, 0.12)',
    'pill-working-text': '#2f4fb8',
    'pill-waiting-bg': 'rgba(48, 164, 108, 0.14)',
    'pill-waiting-text': '#18794e',
    'pill-question-bg': 'rgba(255, 178, 36, 0.2)',
    'pill-question-text': '#9a5b00',
    ...lightShadows('16, 24, 40'),
    'switch-knob': '#ffffff',
    ...LIGHT_MARKS
  }
}

/** Bikube's own (D2, D6): warm near-black and honey; warm cream, dark amber and black text. */
const BIKUBE: AppTheme = {
  id: 'bikube',
  name: 'Bikube',
  dark: {
    bg: '#17140f',
    surface: '#1d1913',
    'surface-raised': '#221e17',
    'surface-hover': '#2b261d',
    'segment-active': '#332d23',
    column: '#1b1812',
    card: '#25211a',
    'card-hover': '#2b261d',
    chip: '#2f2a21',
    border: '#322c22',
    'border-strong': '#463e30',
    text: '#efe8da',
    'text-muted': '#a59a87',
    accent: '#f5b82e',
    'accent-text': '#17140f',
    'accent-soft': 'rgba(245, 184, 46, 0.16)',
    'danger-text': '#17140f',
    backdrop: 'rgba(0, 0, 0, 0.6)',
    'pill-working-bg': 'rgba(245, 184, 46, 0.18)',
    'pill-working-text': '#f7c75a',
    'pill-waiting-bg': 'rgba(143, 179, 87, 0.2)',
    'pill-waiting-text': '#b7d17e',
    'pill-question-bg': 'rgba(232, 110, 44, 0.22)',
    'pill-question-text': '#f79a5e',
    ...DARK_SHADOWS,
    'switch-knob': '#fff8eb',
    ...DARK_MARKS
  },
  light: {
    bg: '#faf5ea',
    surface: '#fffbf3',
    'surface-raised': '#fffdf8',
    'surface-hover': '#f1e9d8',
    'segment-active': '#fffdf8',
    column: '#f3ecdd',
    card: '#fffdf8',
    'card-hover': '#fffdf8',
    chip: '#ebe1cc',
    border: '#e4d9c3',
    'border-strong': '#cfc1a5',
    text: '#17140f',
    'text-muted': '#665a47',
    accent: '#94600a',
    'accent-text': '#ffffff',
    'accent-soft': 'rgba(148, 96, 10, 0.12)',
    'danger-text': '#ffffff',
    backdrop: 'rgba(23, 20, 15, 0.35)',
    'pill-working-bg': 'rgba(245, 184, 46, 0.24)',
    'pill-working-text': '#7a5000',
    'pill-waiting-bg': 'rgba(112, 150, 60, 0.18)',
    'pill-waiting-text': '#4a6a1c',
    'pill-question-bg': 'rgba(214, 92, 24, 0.16)',
    'pill-question-text': '#a33f06',
    ...lightShadows('23, 20, 15'),
    'switch-knob': '#ffffff',
    ...LIGHT_MARKS
  }
}

/** Catppuccin Mocha and Latte. */
const CATPPUCCIN: AppTheme = {
  id: 'catppuccin',
  name: 'Catppuccin',
  dark: {
    bg: '#1e1e2e', // base
    surface: '#181825', // mantle
    'surface-raised': '#313244', // surface0
    'surface-hover': '#313244',
    'segment-active': '#45475a', // surface1
    column: '#181825',
    card: '#313244',
    'card-hover': '#45475a',
    chip: '#45475a',
    border: '#45475a',
    'border-strong': '#585b70', // surface2
    text: '#cdd6f4',
    'text-muted': '#a6adc8', // subtext0
    accent: '#cba6f7', // mauve
    'accent-text': '#11111b', // crust
    'accent-soft': 'rgba(203, 166, 247, 0.16)',
    'danger-text': '#11111b',
    backdrop: 'rgba(17, 17, 27, 0.6)',
    'pill-working-bg': 'rgba(137, 180, 250, 0.12)',
    'pill-working-text': '#89b4fa', // blue
    'pill-waiting-bg': 'rgba(166, 227, 161, 0.18)',
    'pill-waiting-text': '#a6e3a1', // green
    'pill-question-bg': 'rgba(250, 179, 135, 0.2)',
    'pill-question-text': '#fab387', // peach
    ...DARK_SHADOWS,
    'switch-knob': '#cdd6f4',
    ...DARK_MARKS
  },
  light: {
    bg: '#eff1f5', // base
    surface: '#e6e9ef', // mantle
    'surface-raised': '#eff1f5',
    'surface-hover': '#dce0e8', // crust
    'segment-active': '#eff1f5',
    column: '#e6e9ef',
    card: '#eff1f5',
    'card-hover': '#eff1f5',
    chip: '#ccd0da', // surface0
    border: '#ccd0da',
    'border-strong': '#bcc0cc', // surface1
    text: '#4c4f69',
    'text-muted': '#5c5f77', // subtext1
    accent: '#8839ef', // mauve
    'accent-text': '#eff1f5',
    'accent-soft': 'rgba(136, 57, 239, 0.1)',
    'danger-text': '#ffffff', // white for D5
    backdrop: 'rgba(76, 79, 105, 0.35)',
    'pill-working-bg': 'rgba(30, 102, 245, 0.12)',
    'pill-working-text': '#0a55ea', // blue, darker for D5
    'pill-waiting-bg': 'rgba(64, 160, 43, 0.14)',
    'pill-waiting-text': '#2e721f', // green, darker for D5
    'pill-question-bg': 'rgba(254, 100, 11, 0.14)',
    'pill-question-text': '#ac4001', // peach, darker for D5
    ...lightShadows('76, 79, 105'),
    'switch-knob': '#eff1f5',
    ...LIGHT_MARKS
  }
}

/** Rosé Pine Main and Dawn. */
const ROSE_PINE: AppTheme = {
  id: 'rose-pine',
  name: 'Rosé Pine',
  dark: {
    bg: '#191724', // base
    surface: '#1f1d2e', // surface
    'surface-raised': '#26233a', // overlay
    'surface-hover': '#26233a',
    'segment-active': '#403d52', // highlight med
    column: '#1f1d2e',
    card: '#26233a',
    'card-hover': '#403d52',
    chip: '#403d52',
    border: '#403d52',
    'border-strong': '#524f67', // highlight high
    text: '#e0def4',
    'text-muted': '#908caa', // subtle
    accent: '#c4a7e7', // iris
    'accent-text': '#191724',
    'accent-soft': 'rgba(196, 167, 231, 0.16)',
    'danger-text': '#191724',
    backdrop: 'rgba(0, 0, 0, 0.55)',
    'pill-working-bg': 'rgba(196, 167, 231, 0.18)',
    'pill-working-text': '#c4a7e7', // iris
    'pill-waiting-bg': 'rgba(156, 207, 216, 0.18)',
    'pill-waiting-text': '#9ccfd8', // foam
    'pill-question-bg': 'rgba(246, 193, 119, 0.18)',
    'pill-question-text': '#f6c177', // gold
    ...DARK_SHADOWS,
    'switch-knob': '#e0def4',
    ...DARK_MARKS
  },
  light: {
    bg: '#faf4ed', // base
    surface: '#fffaf3', // surface
    'surface-raised': '#fffaf3',
    'surface-hover': '#f4ede8', // highlight low
    'segment-active': '#fffaf3',
    column: '#f2e9e1', // overlay
    card: '#fffaf3',
    'card-hover': '#fffaf3',
    chip: '#dfdad9', // highlight med
    border: '#dfdad9',
    'border-strong': '#cecacd', // highlight high
    text: '#575279',
    'text-muted': '#6a6683', // subtle, darker for D5
    accent: '#286983', // pine
    'accent-text': '#faf4ed',
    'accent-soft': 'rgba(40, 105, 131, 0.1)',
    'danger-text': '#fffaf3',
    backdrop: 'rgba(87, 82, 121, 0.3)',
    'pill-working-bg': 'rgba(144, 122, 169, 0.14)',
    'pill-working-text': '#785f93', // iris, darker for D5
    'pill-waiting-bg': 'rgba(40, 105, 131, 0.12)',
    'pill-waiting-text': '#286983', // pine
    'pill-question-bg': 'rgba(234, 157, 52, 0.16)',
    'pill-question-text': '#975d10', // gold, darker for D5
    ...lightShadows('87, 82, 121'),
    'switch-knob': '#fffaf3',
    ...LIGHT_MARKS
  }
}

/** Nord: Polar Night, Snow Storm and Frost. */
const NORD: AppTheme = {
  id: 'nord',
  name: 'Nord',
  dark: {
    bg: '#2e3440', // nord0
    surface: '#3b4252', // nord1
    'surface-raised': '#434c5e', // nord2
    'surface-hover': '#434c5e',
    'segment-active': '#4c566a', // nord3
    column: '#3b4252',
    card: '#434c5e',
    'card-hover': '#4c566a',
    chip: '#4c566a',
    // Nord's palette has no further step, so border-strong equals border.
    border: '#4c566a', // nord3
    'border-strong': '#4c566a',
    text: '#eceff4', // nord6
    'text-muted': '#d8dee9', // nord4
    accent: '#88c0d0', // nord8
    'accent-text': '#2e3440',
    'accent-soft': 'rgba(136, 192, 208, 0.16)',
    'danger-text': '#15181e', // nord0, darker for D5
    backdrop: 'rgba(0, 0, 0, 0.5)',
    'pill-working-bg': 'rgba(136, 192, 208, 0.14)',
    'pill-working-text': '#b6d8e2', // nord8, lighter for D5
    'pill-waiting-bg': 'rgba(163, 190, 140, 0.14)',
    'pill-waiting-text': '#c6d7b8', // nord14, lighter for D5
    'pill-question-bg': 'rgba(235, 203, 139, 0.14)',
    'pill-question-text': '#eed49f', // nord13, lighter for D5
    ...DARK_SHADOWS,
    'switch-knob': '#eceff4',
    ...DARK_MARKS,
    // Lighter for D5 on nord2's cards.
    'kind-claude': '#dc8163',
    'kind-codex': '#11af88',
    'kind-gemini': '#6299f8'
  },
  light: {
    bg: '#eceff4', // nord6
    surface: '#e5e9f0', // nord5
    'surface-raised': '#eceff4',
    'surface-hover': '#d8dee9', // nord4
    'segment-active': '#eceff4',
    column: '#e5e9f0',
    card: '#eceff4',
    'card-hover': '#eceff4',
    chip: '#d8dee9',
    // Nord's palette has no further step, so border-strong equals border.
    border: '#d8dee9', // nord4
    'border-strong': '#d8dee9',
    text: '#2e3440', // nord0
    'text-muted': '#4c566a', // nord3
    accent: '#4d6e96', // nord10, darker for D5
    'accent-text': '#eceff4',
    'accent-soft': 'rgba(94, 129, 172, 0.12)',
    'danger-text': '#ffffff', // white for D5
    backdrop: 'rgba(46, 52, 64, 0.35)',
    'pill-working-bg': 'rgba(94, 129, 172, 0.14)',
    'pill-working-text': '#476489', // nord10, darker for D5
    'pill-waiting-bg': 'rgba(163, 190, 140, 0.24)',
    'pill-waiting-text': '#526b3c', // nord14, darker for D5
    'pill-question-bg': 'rgba(208, 135, 112, 0.18)',
    'pill-question-text': '#9a4c33', // nord12, darker for D5
    ...lightShadows('46, 52, 64'),
    'switch-knob': '#eceff4',
    ...LIGHT_MARKS
  }
}

/** Gruvbox dark and light. */
const GRUVBOX: AppTheme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  dark: {
    bg: '#282828', // bg0
    surface: '#32302f', // bg0_s
    'surface-raised': '#3c3836', // bg1
    'surface-hover': '#3c3836',
    'segment-active': '#504945', // bg2
    column: '#32302f',
    card: '#3c3836',
    'card-hover': '#504945',
    chip: '#504945',
    border: '#504945',
    'border-strong': '#665c54', // bg3
    text: '#ebdbb2', // fg1
    'text-muted': '#bdae93', // fg3
    accent: '#fe8019', // orange
    'accent-text': '#282828',
    'accent-soft': 'rgba(254, 128, 25, 0.16)',
    'danger-text': '#17191a', // bg0_h, darker for D5
    backdrop: 'rgba(0, 0, 0, 0.55)',
    'pill-working-bg': 'rgba(131, 165, 152, 0.12)',
    'pill-working-text': '#9eb8ae', // blue, lighter for D5
    'pill-waiting-bg': 'rgba(184, 187, 38, 0.1)',
    'pill-waiting-text': '#b8bb26', // green
    'pill-question-bg': 'rgba(250, 189, 47, 0.18)',
    'pill-question-text': '#fabd2f', // yellow
    ...DARK_SHADOWS,
    'switch-knob': '#fbf1c7',
    ...DARK_MARKS
  },
  light: {
    bg: '#fbf1c7', // bg0
    surface: '#f2e5bc', // bg0_s
    'surface-raised': '#f9f5d7', // bg0_h
    'surface-hover': '#ebdbb2', // bg1
    'segment-active': '#f9f5d7',
    column: '#f2e5bc',
    card: '#f9f5d7',
    'card-hover': '#f9f5d7',
    chip: '#ebdbb2',
    border: '#d5c4a1', // bg2
    'border-strong': '#bdae93', // bg3
    text: '#3c3836', // fg1
    'text-muted': '#665c54', // fg3
    accent: '#af3a03', // faded orange
    'accent-text': '#fbf1c7',
    'accent-soft': 'rgba(175, 58, 3, 0.1)',
    'danger-text': '#ffffff', // white for D5
    backdrop: 'rgba(40, 40, 40, 0.35)',
    'pill-working-bg': 'rgba(7, 102, 120, 0.12)',
    'pill-working-text': '#076678', // faded blue
    'pill-waiting-bg': 'rgba(121, 116, 14, 0.14)',
    'pill-waiting-text': '#6b670c', // faded green, darker for D5
    'pill-question-bg': 'rgba(181, 118, 20, 0.16)',
    'pill-question-text': '#895a0f', // faded yellow, darker for D5
    ...lightShadows('40, 40, 40'),
    'switch-knob': '#f9f5d7',
    ...LIGHT_MARKS
  }
}

/** The six app themes in D2's order. */
export const APP_THEMES: readonly AppTheme[] = Object.freeze([
  DEFAULT,
  BIKUBE,
  CATPPUCCIN,
  ROSE_PINE,
  NORD,
  GRUVBOX
])

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && (APP_THEME_IDS as readonly string[]).includes(value)
}

/** The theme with `id`. */
export function appTheme(id: AppThemeId): AppTheme {
  return APP_THEMES.find((theme) => theme.id === id) ?? DEFAULT
}

/** The tokens of `id`'s `version`. */
export function appThemeTokens(id: AppThemeId, version: ResolvedTheme): AppThemeTokens {
  return appTheme(id)[version]
}

/** The window background main creates a window with (D7): the theme's `bg` for the version. */
export function windowBackground(id: AppThemeId, version: ResolvedTheme): string {
  return appThemeTokens(id, version).bg
}

/** `tokens` as CSS declarations (`--bg: #14151a; …`), for a rule the renderer sets. */
export function appThemeDeclarations(tokens: AppThemeTokens): string {
  return APP_THEME_TOKENS.map((token) => `--${token}: ${tokens[token]};`).join(' ')
}
