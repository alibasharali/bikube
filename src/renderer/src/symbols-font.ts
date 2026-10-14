import { SYMBOLS_FONT_FAMILY } from '../../core/terminal-appearance'
import fontUrl from './assets/fonts/SymbolsNerdFontMono-Regular.ttf?url'

/**
 * Loads the bundled Nerd Font symbols (MIT, ryanoasis/nerd-fonts 3.4.0) before any terminal draws:
 * xterm caches each glyph the first time it draws it, so a font still loading would stay a box.
 */
export async function loadSymbolsFont(): Promise<void> {
  try {
    const face = new FontFace(SYMBOLS_FONT_FAMILY, `url(${fontUrl})`)
    document.fonts.add(await face.load())
  } catch (error) {
    console.error(`symbols font not loaded: ${String(error)}`)
  }
}
