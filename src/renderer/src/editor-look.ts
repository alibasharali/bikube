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
const highlight = HighlightStyle.define([
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
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('fg') }
})

/** The editor's theme and syntax colours, for every text tab's state. */
export const editorLook: Extension = [theme, syntaxHighlighting(highlight)]

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
