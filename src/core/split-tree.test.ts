import { describe, expect, it } from 'vitest'
import {
  MAIN_PANE,
  MAX_PANES,
  focusPane,
  initialLayout,
  paneIds,
  removePane,
  splitFocused,
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
