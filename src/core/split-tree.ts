/**
 * A card's panes (#11 D1–D3, D5): a tree of 50/50 splits whose leaves are panes, plus which
 * pane is focused. The main pane is the card's own terminal; every other leaf is an extra pane.
 * Plain data, replaced (never mutated) on every change, so a view can compare by identity.
 */

/** The main pane's id: the card's own terminal (D1). */
export const MAIN_PANE = 'main'

/** A card's full-size view shows at most this many panes (D2). */
export const MAX_PANES = 4

/** `right` puts the new pane to the right of the split one, `down` below it (D2). */
export type SplitDirection = 'right' | 'down'

export type SplitTree =
  | { kind: 'leaf'; id: string }
  | { kind: 'split'; direction: SplitDirection; first: SplitTree; second: SplitTree }

export interface PaneLayout {
  tree: SplitTree
  /** Exactly one pane is focused (D3). */
  focused: string
}

/** Just the main pane, focused: a card's view when it first opens for a start (D3). */
export function initialLayout(): PaneLayout {
  return { tree: { kind: 'leaf', id: MAIN_PANE }, focused: MAIN_PANE }
}

/** The panes' ids in tree order: left before right, top before bottom. */
export function paneIds(tree: SplitTree): string[] {
  return tree.kind === 'leaf' ? [tree.id] : [...paneIds(tree.first), ...paneIds(tree.second)]
}

/** Whether another pane fits (D2): fewer than 4. */
export function canSplit(layout: PaneLayout): boolean {
  return paneIds(layout.tree).length < MAX_PANES
}

/**
 * Splits the focused pane into two equal halves, the new pane `id` to its right or below it,
 * and focuses the new pane (D2, D3). At 4 panes it returns `layout` itself.
 */
export function splitFocused(
  layout: PaneLayout,
  direction: SplitDirection,
  id: string
): PaneLayout {
  if (!canSplit(layout)) return layout
  const split = (tree: SplitTree): SplitTree => {
    if (tree.kind === 'leaf') {
      if (tree.id !== layout.focused) return tree
      return { kind: 'split', direction, first: tree, second: { kind: 'leaf', id } }
    }
    return { ...tree, first: split(tree.first), second: split(tree.second) }
  }
  return { tree: split(layout.tree), focused: id }
}

/** Focuses pane `id` (D3); an unknown pane, or the focused one, returns `layout` itself. */
export function focusPane(layout: PaneLayout, id: string): PaneLayout {
  if (layout.focused === id || !paneIds(layout.tree).includes(id)) return layout
  return { tree: layout.tree, focused: id }
}

/**
 * Removes extra pane `id`; its sibling in the tree takes the freed space (D5). The main pane
 * comes back into focus if `id` was focused (D3). The main pane, or an unknown one, returns
 * `layout` itself.
 */
export function removePane(layout: PaneLayout, id: string): PaneLayout {
  if (id === MAIN_PANE || !paneIds(layout.tree).includes(id)) return layout
  const remove = (tree: SplitTree): SplitTree => {
    if (tree.kind === 'leaf') return tree
    if (tree.first.kind === 'leaf' && tree.first.id === id) return tree.second
    if (tree.second.kind === 'leaf' && tree.second.id === id) return tree.first
    return { ...tree, first: remove(tree.first), second: remove(tree.second) }
  }
  return { tree: remove(layout.tree), focused: layout.focused === id ? MAIN_PANE : layout.focused }
}
