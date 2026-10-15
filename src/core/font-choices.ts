/**
 * The fonts the Font family setting offers by name: well-known coding fonts, Nerd Font variants
 * included. Only the installed ones are listed; any other family is typed as Custom. Plain TS.
 */
import { DEFAULT_FONT_FAMILY } from './settings'

export const FONT_CHOICES: readonly string[] = Object.freeze([
  'SF Mono',
  'Menlo',
  'Monaco',
  'JetBrains Mono',
  'JetBrainsMono Nerd Font',
  'Fira Code',
  'FiraCode Nerd Font',
  'Cascadia Code',
  'Source Code Pro',
  'IBM Plex Mono',
  'Hack',
  'Hack Nerd Font',
  'MesloLGS NF',
  'Iosevka',
  'Geist Mono',
  'Victor Mono',
  'Ubuntu Mono',
  'DejaVu Sans Mono',
  'Consolas',
  'Courier New'
])

/** The family saved for font `name`: it first, the terminal's generic monospace after. */
export function familyOf(name: string): string {
  return `"${name}", monospace`
}

export type FontChoice = { kind: 'default' } | { kind: 'font'; name: string } | { kind: 'custom' }

/** Which entry of the Font family list `family` is: the default, a listed font, or Custom. */
export function fontChoiceOf(family: string): FontChoice {
  if (family === DEFAULT_FONT_FAMILY) return { kind: 'default' }
  const m = /^"([^"]+)", monospace$/.exec(family)
  if (m && FONT_CHOICES.includes(m[1]!)) return { kind: 'font', name: m[1]! }
  return { kind: 'custom' }
}
