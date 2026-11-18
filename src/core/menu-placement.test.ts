import { describe, expect, it } from 'vitest'
import { menuPlacement } from './menu-placement'

const view = { width: 1000, height: 600 }
const button = (
  top: number,
  left = 500
): { top: number; bottom: number; left: number; right: number } => ({
  top,
  bottom: top + 20,
  left,
  right: left + 20
})
const menu = { width: 200, height: 300 }

describe('menuPlacement', () => {
  it('opens under the button when the menu fits there', () => {
    expect(menuPlacement(button(100), menu, view, 'end')).toEqual({ top: 124, left: 320 })
  })

  it('opens above the button when it does not fit under it', () => {
    expect(menuPlacement(button(500), menu, view, 'end')).toEqual({ top: 196, left: 320 })
  })

  it('caps the menu to the larger side when it fits on neither', () => {
    const tall = { width: 200, height: 500 }
    expect(menuPlacement(button(200), tall, view, 'end')).toEqual({
      top: 224,
      left: 320,
      maxHeight: 372
    })
    expect(menuPlacement(button(400), tall, view, 'end')).toEqual({
      top: 4,
      left: 320,
      maxHeight: 392
    })
  })

  it('lines up with the start edge and stays inside the window sideways', () => {
    expect(menuPlacement(button(100, 900), menu, view, 'start').left).toBe(796)
    expect(menuPlacement(button(100, 50), menu, view, 'end').left).toBe(0)
    expect(menuPlacement(button(100, 50), menu, view, 'start').left).toBe(50)
  })
})
