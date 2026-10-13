import { describe, expect, it } from 'vitest'
import { dropIndex, hoverHalf, nearestCardHover } from './card-drops'

describe('dropIndex', () => {
  const column = ['a', 'b', 'c']

  it('goes above a card in its top half and below it in its bottom half', () => {
    expect(dropIndex(['x', 'y'], 'a', { cardId: 'x', half: 'top' })).toBe(0)
    expect(dropIndex(['x', 'y'], 'a', { cardId: 'x', half: 'bottom' })).toBe(1)
    expect(dropIndex(['x', 'y'], 'a', { cardId: 'y', half: 'top' })).toBe(1)
    expect(dropIndex(['x', 'y'], 'a', { cardId: 'y', half: 'bottom' })).toBe(2)
  })

  it('lands at the bottom over the header, empty area, space below or + New card', () => {
    expect(dropIndex(['x', 'y'], 'a', 'bottom')).toBe(2)
    expect(dropIndex([], 'a', 'bottom')).toBe(0)
  })

  it('counts without the dragged card when dragging within the same column', () => {
    expect(dropIndex(column, 'c', { cardId: 'a', half: 'top' })).toBe(0)
    expect(dropIndex(column, 'c', { cardId: 'b', half: 'bottom' })).toBe(2)
    expect(dropIndex(column, 'a', { cardId: 'c', half: 'bottom' })).toBe(2)
    expect(dropIndex(column, 'a', { cardId: 'b', half: 'top' })).toBe(0)
    expect(dropIndex(column, 'a', 'bottom')).toBe(2)
  })

  it('over the dragged card itself, keeps its place', () => {
    expect(dropIndex(column, 'b', { cardId: 'b', half: 'top' })).toBe(1)
    expect(dropIndex(column, 'b', { cardId: 'b', half: 'bottom' })).toBe(1)
  })

  it('treats an unknown hovered card as the bottom', () => {
    expect(dropIndex(column, 'a', { cardId: 'zz', half: 'top' })).toBe(2)
  })
})

describe('hoverHalf', () => {
  it('splits a card at its middle', () => {
    expect(hoverHalf(100, 100, 40)).toBe('top')
    expect(hoverHalf(119, 100, 40)).toBe('top')
    expect(hoverHalf(120, 100, 40)).toBe('bottom')
    expect(hoverHalf(140, 100, 40)).toBe('bottom')
  })
})

describe('nearestCardHover', () => {
  // a: 10-50, gap 50-58, b: 58-98, gap 98-106, c: 106-146.
  const boxes = [
    { cardId: 'a', top: 10, height: 40 },
    { cardId: 'b', top: 58, height: 40 },
    { cardId: 'c', top: 106, height: 40 }
  ]

  it('in the gap between two cards, the nearer card decides by its half', () => {
    expect(nearestCardHover(boxes, 52)).toEqual({ cardId: 'a', half: 'bottom' })
    expect(nearestCardHover(boxes, 56)).toEqual({ cardId: 'b', half: 'top' })
    expect(nearestCardHover(boxes, 104)).toEqual({ cardId: 'c', half: 'top' })
  })

  it('just above the first card goes above it', () => {
    expect(nearestCardHover(boxes, 6)).toEqual({ cardId: 'a', half: 'top' })
  })

  it('over a card uses that card', () => {
    expect(nearestCardHover(boxes, 70)).toEqual({ cardId: 'b', half: 'top' })
    expect(nearestCardHover(boxes, 90)).toEqual({ cardId: 'b', half: 'bottom' })
  })

  it('below the last card, or with no cards, means the bottom', () => {
    expect(nearestCardHover(boxes, 146)).toBe('bottom')
    expect(nearestCardHover(boxes, 150)).toBe('bottom')
    expect(nearestCardHover([], 10)).toBe('bottom')
  })
})
