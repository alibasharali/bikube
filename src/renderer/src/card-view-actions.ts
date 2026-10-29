/**
 * The open card view's actions (#31 D5), run by its shortcuts and by the command palette
 * (#40 D6) through the same code: the card view registers what runs them while it is shown.
 */
export type CardViewAction =
  | 'back'
  | 'splitRight'
  | 'splitDown'
  | 'closePane'
  | 'closeCard'
  | 'find'
  | 'previousPrompt'
  | 'nextPrompt'
  | 'zoomPane'
  | 'openInWindow'
  | 'copyCommandOutput'
  | 'editDescription'
  | 'focusNextPane'
  | 'focusPreviousPane'
  | 'equalizePanes'
  | 'resizePaneLeft'
  | 'resizePaneRight'
  | 'resizePaneUp'
  | 'resizePaneDown'
  | 'renameCard'

const CARD_VIEW_ACTIONS: readonly string[] = [
  'back',
  'splitRight',
  'splitDown',
  'closePane',
  'closeCard',
  'find',
  'previousPrompt',
  'nextPrompt',
  'zoomPane',
  'openInWindow',
  'copyCommandOutput',
  'editDescription',
  'focusNextPane',
  'focusPreviousPane',
  'equalizePanes',
  'resizePaneLeft',
  'resizePaneRight',
  'resizePaneUp',
  'resizePaneDown',
  'renameCard'
] satisfies CardViewAction[]

export const isCardViewAction = (action: string | null): action is CardViewAction =>
  action !== null && CARD_VIEW_ACTIONS.includes(action)

let runner: ((action: CardViewAction) => void) | null = null

/** Makes `run` the open view's runner; returns what removes it again. */
export function registerCardViewActions(run: (action: CardViewAction) => void): () => void {
  runner = run
  return () => {
    if (runner === run) runner = null
  }
}

/** Runs `action` in the open card view, as its shortcut does; nothing without one. */
export function runCardViewAction(action: CardViewAction): void {
  runner?.(action)
}
