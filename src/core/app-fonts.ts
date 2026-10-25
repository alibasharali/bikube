/**
 * The App font setting's list (#66 D7): common UI fonts offered by name; only the installed ones
 * are shown, any other family is typed as Custom. Plain TS, no DOM.
 */

/** The chrome's system UI stack, main.css's `--font-ui` (a test keeps them equal). */
export const UI_FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export const APP_FONT_CHOICES: readonly string[] = Object.freeze([
  'Inter',
  'SF Pro Text',
  'Helvetica Neue',
  'Segoe UI',
  'Roboto',
  'Ubuntu',
  'Cantarell',
  'Noto Sans',
  'Open Sans',
  'Source Sans 3',
  'IBM Plex Sans',
  'DejaVu Sans',
  'Arial'
])

/** The family saved for listed font `name`: it first, the system UI stack for missing glyphs. */
export function appFontOf(name: string): string {
  return `"${name}", ${UI_FONT_STACK}`
}

export type AppFontChoice =
  { kind: 'default' } | { kind: 'font'; name: string } | { kind: 'custom' }

/** Which entry of the App font list `family` is: the default (''), a listed font, or Custom. */
export function appFontChoiceOf(family: string): AppFontChoice {
  if (family === '') return { kind: 'default' }
  const name = APP_FONT_CHOICES.find((n) => appFontOf(n) === family)
  return name === undefined ? { kind: 'custom' } : { kind: 'font', name }
}
