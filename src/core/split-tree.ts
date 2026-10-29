/**
 * A card's panes (#11 D1–D3, D5): a tree of splits (50/50 until resized) whose leaves are panes,
 * plus which pane is focused. The main pane is the card's own terminal; every other leaf is an extra pane.
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
  | {
      kind: 'split'
      direction: SplitDirection
      first: SplitTree
      second: SplitTree
      /** The first side's share, 0.1 to 0.9; absent for half. */
      ratio?: number
    }

export interface PaneLayout {
  tree: SplitTree
  /** Exactly one pane is focused (D3). */
  focused: string
  /**
   * Set while the view shows only the focused pane, filling the pane area (#48 D1); the tree is
   * unchanged, so unzooming shows the layout from before. Never set with one pane.
   */
  zoomed?: true
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
 * and focuses the new pane (D2, D3), ending a zoom (#48 D4). At 4 panes it returns `layout`
 * itself.
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
  return { ...layout, focused: id }
}

/**
 * Removes extra pane `id`; its sibling in the tree takes the freed space (D5). The main pane
 * comes back into focus if `id` was focused (D3), ending a zoom (#48 D4). The main pane, or an
 * unknown one, returns `layout` itself.
 */
export function removePane(layout: PaneLayout, id: string): PaneLayout {
  if (id === MAIN_PANE || !paneIds(layout.tree).includes(id)) return layout
  const remove = (tree: SplitTree): SplitTree => {
    if (tree.kind === 'leaf') return tree
    if (tree.first.kind === 'leaf' && tree.first.id === id) return tree.second
    if (tree.second.kind === 'leaf' && tree.second.id === id) return tree.first
    return { ...tree, first: remove(tree.first), second: remove(tree.second) }
  }
  const tree = remove(layout.tree)
  if (layout.focused === id) return { tree, focused: MAIN_PANE }
  // A hidden pane going keeps the zoom while another pane is left to hide (#48 D1, D4).
  const zoomed = layout.zoomed && paneIds(tree).length > 1
  return zoomed ? { tree, focused: layout.focused, zoomed } : { tree, focused: layout.focused }
}

/**
 * Zooms the focused pane, or ends the zoom (#48 D1). A single pane is never zoomed: it returns
 * `layout` itself.
 */
export function toggleZoom(layout: PaneLayout): PaneLayout {
  if (layout.zoomed) return { tree: layout.tree, focused: layout.focused }
  if (paneIds(layout.tree).length < 2) return layout
  return { tree: layout.tree, focused: layout.focused, zoomed: true }
}

/** The focused pane's next (1) or previous (-1) in tree order, wrapping; a zoom stays on it. */
export function focusAdjacent(layout: PaneLayout, step: 1 | -1): PaneLayout {
  const ids = paneIds(layout.tree)
  const at = ids.indexOf(layout.focused)
  return focusPane(layout, ids[(at + step + ids.length) % ids.length]!)
}

/**
 * Every pane the same size along each run of splits in one direction (Ghostty's
 * equalize_splits): three panes side by side each get a third. Unchanged when they already are.
 */
export function equalize(layout: PaneLayout): PaneLayout {
  const weight = (tree: SplitTree, direction: SplitDirection): number =>
    tree.kind === 'split' && tree.direction === direction
      ? weight(tree.first, direction) + weight(tree.second, direction)
      : 1
  let changed = false
  const even = (tree: SplitTree): SplitTree => {
    if (tree.kind === 'leaf') return tree
    const first = weight(tree.first, tree.direction)
    const ratio = first / (first + weight(tree.second, tree.direction))
    if ((tree.ratio ?? 0.5) !== ratio) changed = true
    const next = {
      kind: 'split',
      direction: tree.direction,
      first: even(tree.first),
      second: even(tree.second)
    } as const
    return withRatio(next, ratio)
  }
  const tree = even(layout.tree)
  return changed ? { ...layout, tree } : layout
}

export const MIN_SPLIT_RATIO = 0.1
/** How far one Resize pane press moves a divider: a share of the split's size. */
export const RESIZE_STEP = 0.05

/**
 * Moves the divider of the split nearest the focused pane along that axis by `step`, towards
 * `direction` (Ghostty's resize_split): left and right a side-by-side split's, up and down a
 * stacked one's, keeping each side at least a tenth. Unchanged when there is none or it is at
 * its limit.
 */
export function resizeFocused(
  layout: PaneLayout,
  direction: 'left' | 'right' | 'up' | 'down',
  step = RESIZE_STEP
): PaneLayout {
  const axis: SplitDirection = direction === 'left' || direction === 'right' ? 'right' : 'down'
  const delta = direction === 'left' || direction === 'up' ? -step : step
  let found = false
  let changed = false
  const resize = (tree: SplitTree): SplitTree => {
    if (tree.kind === 'leaf' || !paneIds(tree).includes(layout.focused)) return tree
    const first = resize(tree.first)
    const second = resize(tree.second)
    const old = tree.ratio ?? 0.5
    if (found || tree.direction !== axis) return { ...tree, first, second }
    found = true
    const ratio =
      Math.round(Math.min(1 - MIN_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, old + delta)) * 100) / 100
    changed = ratio !== old
    return withRatio({ kind: 'split', direction: tree.direction, first, second }, ratio)
  }
  const tree = resize(layout.tree)
  return changed ? { ...layout, tree } : layout
}

/** `split` with `ratio`, left out for half. */
function withRatio(split: Extract<SplitTree, { kind: 'split' }>, ratio: number): SplitTree {
  return ratio === 0.5 ? split : { ...split, ratio }
}
