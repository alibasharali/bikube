import { describe, expect, it } from 'vitest'
import {
  MAIN_PANE,
  MAX_PANES,
  equalize,
  focusAdjacent,
  focusPane,
  resizeFocused,
  initialLayout,
  paneIds,
  removePane,
  splitFocused,
  toggleZoom,
  type PaneLayout
} from './split-tree'

describe('splitFocused', () => {
  it('splits the focused main pane right into two halves and focuses the new pane', () => {
    const layout = splitFocused(initialLayout(), 'right', 'p1')
    expect(layout.tree).toEqual({
      kind: 'split',
      direction: 'right',
      first: { kind: 'leaf', id: MAIN_PANE },
      second: { kind: 'leaf', id: 'p1' }
    })
    expect(layout.focused).toBe('p1')
    expect(paneIds(layout.tree)).toEqual([MAIN_PANE, 'p1'])
  })
})

describe('splitFocused nesting and the limit', () => {
  it('splits a half again, in the other direction, nesting in place', () => {
    const two = splitFocused(initialLayout(), 'right', 'p1')
    const three = splitFocused(two, 'down', 'p2')
    expect(three.tree).toEqual({
      kind: 'split',
      direction: 'right',
      first: { kind: 'leaf', id: MAIN_PANE },
      second: {
        kind: 'split',
        direction: 'down',
        first: { kind: 'leaf', id: 'p1' },
        second: { kind: 'leaf', id: 'p2' }
      }
    })
    expect(three.focused).toBe('p2')
    expect(paneIds(three.tree)).toEqual([MAIN_PANE, 'p1', 'p2'])
  })

  it('returns the same layout at 4 panes', () => {
    let layout = initialLayout()
    for (const id of ['p1', 'p2', 'p3']) layout = splitFocused(layout, 'right', id)
    expect(paneIds(layout.tree)).toHaveLength(MAX_PANES)
    expect(splitFocused(layout, 'down', 'p4')).toBe(layout)
  })
})

/** Main | (p1 over p2), p2 focused: AC2's first step. */
function threePanes(): PaneLayout {
  return splitFocused(splitFocused(initialLayout(), 'right', 'p1'), 'down', 'p2')
}

describe('removePane', () => {
  it('lets the sibling of the removed pane take its place and focuses the main pane', () => {
    const two = removePane(threePanes(), 'p2')
    expect(two.tree).toEqual({
      kind: 'split',
      direction: 'right',
      first: { kind: 'leaf', id: MAIN_PANE },
      second: { kind: 'leaf', id: 'p1' }
    })
    expect(two.focused).toBe(MAIN_PANE)
    const one = removePane(two, 'p1')
    expect(one).toEqual(initialLayout())
  })

  it('keeps the focus on another pane when an unfocused pane goes away', () => {
    const layout = removePane(focusPane(threePanes(), 'p1'), 'p2')
    expect(layout.focused).toBe('p1')
    expect(paneIds(layout.tree)).toEqual([MAIN_PANE, 'p1'])
  })

  it('never removes the main pane, and ignores an unknown pane', () => {
    const layout = threePanes()
    expect(removePane(layout, MAIN_PANE)).toBe(layout)
    expect(removePane(layout, 'nope')).toBe(layout)
  })
})

describe('focusPane', () => {
  it('focuses a pane in the tree and ignores an unknown one', () => {
    const layout = threePanes()
    expect(focusPane(layout, MAIN_PANE)).toEqual({ tree: layout.tree, focused: MAIN_PANE })
    expect(focusPane(layout, 'p2')).toBe(layout)
    expect(focusPane(layout, 'nope')).toBe(layout)
  })
})

describe('toggleZoom (#48 D1, AC8)', () => {
  it('returns the same layout for a single pane', () => {
    const layout = initialLayout()
    expect(toggleZoom(layout)).toBe(layout)
  })
})

describe('zoom and the other layout changes (#48 D1, D4, AC8)', () => {
  it('zooms a split layout and gives back an equal tree and focus when unzoomed', () => {
    const layout = threePanes()
    const zoomed = toggleZoom(layout)
    expect(zoomed.zoomed).toBe(true)
    expect(zoomed.tree).toEqual(layout.tree)
    expect(zoomed.focused).toBe('p2')
    expect(toggleZoom(zoomed)).toEqual(layout)
  })

  it('ends the zoom when a zoomed layout is split, with the new pane focused', () => {
    const layout = splitFocused(toggleZoom(threePanes()), 'right', 'p3')
    expect(layout.zoomed).toBeUndefined()
    expect(layout.focused).toBe('p3')
    expect(paneIds(layout.tree)).toEqual([MAIN_PANE, 'p1', 'p2', 'p3'])
  })

  it('ends the zoom when the zoomed (focused) pane is removed', () => {
    const layout = removePane(toggleZoom(threePanes()), 'p2')
    expect(layout.zoomed).toBeUndefined()
    expect(layout.focused).toBe(MAIN_PANE)
  })

  it('keeps the zoom when a hidden pane goes and more than one pane remains', () => {
    const layout = removePane(toggleZoom(threePanes()), 'p1')
    expect(layout.zoomed).toBe(true)
    expect(layout.focused).toBe('p2')
    expect(paneIds(layout.tree)).toEqual([MAIN_PANE, 'p2'])
  })

  it('ends the zoom when a hidden pane goes and only one pane remains', () => {
    const two = splitFocused(initialLayout(), 'right', 'p1')
    const layout = removePane(toggleZoom(focusPane(two, MAIN_PANE)), 'p1')
    expect(layout).toEqual(initialLayout())
  })
})

describe('focusAdjacent, equalize and resizeFocused (Ghostty goto_split, equalize_splits, resize_split)', () => {
  // main | (p1 over p2), p2 focused.
  const three = (): PaneLayout =>
    splitFocused(splitFocused(initialLayout(), 'right', 'p1'), 'down', 'p2')

  it('moves the focus to the next and previous pane in tree order, wrapping', () => {
    const layout = three()
    expect(focusAdjacent(layout, 1).focused).toBe(MAIN_PANE)
    expect(focusAdjacent(layout, -1).focused).toBe('p1')
    const single = initialLayout()
    expect(focusAdjacent(single, 1)).toBe(single)
  })

  it('keeps a zoom on the newly focused pane', () => {
    const zoomed = toggleZoom(three())
    expect(focusAdjacent(zoomed, 1)).toMatchObject({ focused: MAIN_PANE, zoomed: true })
  })

  it('moves the divider nearest the focused pane along its axis, within a tenth of each side', () => {
    const right = resizeFocused(three(), 'right')
    expect(right.tree).toMatchObject({ direction: 'right', ratio: 0.55 })
    const down = resizeFocused(three(), 'up')
    expect(down.tree).toMatchObject({ second: { direction: 'down', ratio: 0.45 } })
    let far = three()
    for (let i = 0; i < 20; i++) far = resizeFocused(far, 'left')
    expect(far.tree).toMatchObject({ ratio: 0.1 })
    expect(resizeFocused(far, 'left')).toBe(far)
    expect(resizeFocused(initialLayout(), 'right')).toEqual(initialLayout())
  })

  it('gives every pane in a run of splits the same share, and changes nothing when they have it', () => {
    // main | p1 | p2 side by side: the outer split gives main a third.
    const row = splitFocused(splitFocused(initialLayout(), 'right', 'p1'), 'right', 'p2')
    const even = equalize(row)
    expect(even.tree).toMatchObject({ ratio: 1 / 3, second: { direction: 'right' } })
    expect(equalize(even)).toBe(even)
    const resized = resizeFocused(three(), 'right')
    expect(equalize(resized).tree).not.toHaveProperty('ratio')
  })
})
