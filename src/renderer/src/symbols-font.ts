import { SYMBOLS_FONT_FAMILY } from '../../core/terminal-appearance'
import fontUrl from './assets/fonts/SymbolsNerdFontMono-Regular.ttf?url'

/**
 * Loads the bundled Nerd Font symbols (Nerd Fonts 3.4.0; licences in THIRD_PARTY_NOTICES) into
 * `view`'s document (the main window's, or a card window's, #53 D4) before any terminal draws
 * there: xterm caches each glyph the first time it draws it, so a font still loading would stay a
 * box.
 */
export async function loadSymbolsFont(view: Window = window): Promise<void> {
  try {
    // The window's own FontFace, from an absolute URL: a card window is `about:blank`.
    const FontFaceIn = (view as Window & typeof globalThis).FontFace
    const url = new URL(fontUrl, document.baseURI).href
    const face = new FontFaceIn(SYMBOLS_FONT_FAMILY, `url(${url})`)
    view.document.fonts.add(await face.load())
  } catch (error) {
    console.error(`symbols font not loaded: ${String(error)}`)
  }
}
