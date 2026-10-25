import { settingsStore } from './settings'

/**
 * The App font in every window (#66 D7): the saved family as `--font-ui` on each document's root
 * element, in the main page and each card window, so everything drawn with the UI stack follows
 * it at once; '' leaves main.css's system stack. `--font-mono` and the terminals are untouched.
 */

const documents = new Set<Document>([document])
let applied = ''

function writeTo(doc: Document, family: string): void {
  if (family === '') doc.documentElement.style.removeProperty('--font-ui')
  else doc.documentElement.style.setProperty('--font-ui', family)
}

function apply(family: string): void {
  if (family === applied) return
  applied = family
  for (const doc of documents) writeTo(doc, family)
}

/** Follows the App font setting from now on; call once the settings store is loaded. */
export function followAppFont(): void {
  apply(settingsStore.get().appFontFamily)
  settingsStore.subscribe(() => apply(settingsStore.get().appFontFamily))
}

/**
 * Gives `doc` (a card window's) the current App font and keeps it following the setting; returns
 * the function that stops that, for when the window closes.
 */
export function fontDocument(doc: Document): () => void {
  documents.add(doc)
  writeTo(doc, applied)
  return () => documents.delete(doc)
}
