import type { PaletteAction, PaletteItems } from '../../core/palette'

/**
 * The Orchestrator's `board palette` (#81 D23): the app lists the palette's rows for the view it
 * shows and runs a row exactly as picking it would.
 */
export interface BoardPalette {
  items: () => PaletteItems
  run: (action: PaletteAction) => void
}

let handler: BoardPalette | null = null

/** The app answers `board palette`. Returns an unsubscribe. */
export function onBoardPalette(palette: BoardPalette): () => void {
  handler = palette
  return () => {
    if (handler === palette) handler = null
  }
}

/** The palette's rows now; none while no app answers. */
export function boardPaletteItems(): PaletteItems {
  return handler?.items() ?? { cards: [], shells: [], actions: [] }
}

/** Runs an action row as the palette would. */
export function runBoardPalette(action: PaletteAction): void {
  handler?.run(action)
}
