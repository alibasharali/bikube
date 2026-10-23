import { APP_THEME_ATTR, appThemeStylesheet, type AppThemeId } from '../../core/app-themes'
import { settingsStore } from './settings'

/**
 * The App theme in every window (#64 D7): one `<style data-app-theme>` per document, in the main
 * page and each card window, holding the picked theme's rule (`appThemeStylesheet`), replaced in
 * all of them when the setting changes. Picking a theme is saving `appTheme` through the settings
 * store; nothing else needs to apply it.
 */

/** The attribute marking the theme's style element, which `copyStylesheets` leaves to this module. */
export { APP_THEME_ATTR }

const documents = new Set<Document>([document])
let applied: AppThemeId | undefined

function writeTo(doc: Document, id: AppThemeId): void {
  // In the main page the preload already put the launch theme's element in (D7): reused here.
  let style = doc.head.querySelector<HTMLStyleElement>(`style[${APP_THEME_ATTR}]`)
  if (!style) {
    style = doc.createElement('style')
    style.setAttribute(APP_THEME_ATTR, '')
    doc.head.appendChild(style)
  }
  style.setAttribute(APP_THEME_ATTR, id)
  style.textContent = appThemeStylesheet(id)
}

/** Applies theme `id` to every themed document, unless it is the one they already show. */
function apply(id: AppThemeId): void {
  if (id === applied) return
  applied = id
  for (const doc of documents) writeTo(doc, id)
}

/**
 * Applies the theme main created the window with; call first thing at startup. The preload has
 * normally put it in before the first paint already (D7), so this only adopts its element.
 */
export function applyLaunchAppTheme(): void {
  apply(window.bikube.appTheme)
}

/** Follows the App theme setting from now on; call once the settings store is loaded. */
export function followAppTheme(): void {
  apply(settingsStore.get().appTheme)
  settingsStore.subscribe(() => apply(settingsStore.get().appTheme))
}

/**
 * Gives `doc` (a card window's) the current theme and keeps it following the setting; returns the
 * function that stops that, for when the window closes.
 */
export function themeDocument(doc: Document): () => void {
  documents.add(doc)
  if (applied !== undefined) writeTo(doc, applied)
  return () => documents.delete(doc)
}
