import { describe, expect, it } from 'vitest'
import { dropIndex, hoverHalf } from './card-drops'

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
