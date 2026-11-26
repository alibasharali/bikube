import { useSyncExternalStore } from 'react'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import { DEFAULT_FONT_FAMILY, normalizeFontFamily, resolveTheme } from '../../core/settings'
import { terminalPalette, withSymbols, type TerminalPalette } from '../../core/terminal-appearance'
import { ghosttyStore } from './ghostty'
import { effectiveSettings, settingsStore, useEffectiveSettings } from './settings'

/**
 * The file editor's look (#83 D8): the terminal's font, background and ANSI colours, so it reads
 * like the terminal next to it in every terminal theme. CodeMirror's theme and highlighting name
 * CSS custom properties, which the view sets from the palette (`editorLookStyle`), so a theme
 * change needs no reconfiguring.
 */

const v = (name: string): string => `var(--editor-${name})`

/** Keywords magenta, strings green, numbers and constants yellow, comments bright black, functions blue, types and tags cyan. */
export const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword
    ],
    color: v('magenta')
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.inserted], color: v('green') },
  {
    tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name), t.standard(t.name), t.unit],
    color: v('yellow')
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: v('comment') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: v('blue') },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName, t.attributeName, t.labelName],
    color: v('cyan')
  },
  { tag: [t.deleted, t.invalid], color: v('red') },
  { tag: t.heading, color: v('blue'), fontWeight: 'bold' },
  { tag: [t.link, t.url], color: v('cyan'), textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' }
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: v('fg'),
    backgroundColor: v('bg')
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: v('font'),
    fontSize: v('font-size'),
    lineHeight: '1.4'
  },
  '.cm-content': { caretColor: v('cursor') },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: v('cursor') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: v('selection') },
  '.cm-gutters': {
    backgroundColor: v('bg'),
    color: v('comment'),
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('fg') },
  // Find's search panel (#83 D14): the app's chrome, on its tokens, above the code.
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-sm)'
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-1) var(--space-2)',
    padding: 'var(--space-1) var(--space-6) var(--space-1) var(--space-2)'
  },
  '.cm-search br': { display: 'none' },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text)'
  },
  '.cm-search input[type=checkbox]': { margin: 0, accentColor: 'var(--accent)' },
  '.cm-textfield': {
    minWidth: 0,
    minHeight: '24px',
    margin: 0,
    padding: '0 var(--space-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    font: 'inherit'
  },
  '.cm-textfield:focus': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-button': {
    minHeight: '24px',
    margin: 0,
    padding: '0 var(--space-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundImage: 'none',
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text)',
    font: 'inherit',
    cursor: 'pointer'
  },
  '.cm-button:hover': { backgroundColor: 'var(--surface-hover)' },
  '.cm-button:active': { backgroundImage: 'none' },
  '.cm-search button[name=close]': {
    top: 'var(--space-1)',
    right: 'var(--space-1)',
    width: '24px',
    height: '24px',
    padding: 0,
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 'var(--text-md)',
    cursor: 'pointer'
  },
  '.cm-search button[name=close]:hover': {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text)'
  },
  // Matches on the code's background: outlined in the accent, the current one filled too.
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent-soft)',
    outline: '1px solid var(--accent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent-soft)',
    outline: '2px solid var(--accent)'
  }
})

/** The editor's theme and syntax colours, for every text tab's state. */
export const editorLook: Extension = [theme, syntaxHighlighting(editorHighlightStyle)]

/** The custom properties the theme reads, from the terminal's palette and font. */
export function editorLookStyle(
  palette: Readonly<TerminalPalette>,
  fontFamily: string,
  fontSize: number
): Record<string, string> {
  return {
    '--editor-bg': palette.background,
    '--editor-fg': palette.foreground,
    '--editor-cursor': palette.cursor,
    '--editor-selection': palette.selectionBackground,
    '--editor-comment': palette.brightBlack,
    '--editor-red': palette.red,
    '--editor-green': palette.green,
    '--editor-yellow': palette.yellow,
    '--editor-blue': palette.blue,
    '--editor-magenta': palette.magenta,
    '--editor-cyan': palette.cyan,
    '--editor-font': fontFamily,
    '--editor-font-size': `${fontSize}px`
  }
}

let darkQuery: MediaQueryList | undefined
const osPrefersDark = (): boolean => {
  darkQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
  return darkQuery.matches
}

function subscribePalette(listener: () => void): () => void {
  osPrefersDark()
  const offSettings = settingsStore.subscribe(listener)
  const offGhostty = ghosttyStore.subscribe(listener)
  darkQuery?.addEventListener('change', listener)
  return () => {
    offSettings()
    offGhostty()
    darkQuery?.removeEventListener('change', listener)
  }
}

/** The terminal theme's palette now, as the terminals pick it (Ghostty's included). */
function currentPalette(): Readonly<TerminalPalette> {
  const settings = effectiveSettings()
  return terminalPalette(
    settings,
    resolveTheme(settings.theme, osPrefersDark()),
    ghosttyStore.palettes()
  )
}

/** The editor's custom properties for the terminal look now, following every change. */
export function useEditorLookStyle(): Record<string, string> {
  const palette = useSyncExternalStore(subscribePalette, currentPalette)
  const { fontFamily, fontSize } = useEffectiveSettings()
  return editorLookStyle(
    palette,
    withSymbols(normalizeFontFamily(fontFamily) ?? DEFAULT_FONT_FAMILY),
    fontSize
  )
}
