import { describe, expect, it } from 'vitest'
import { draggedPanelWidth, shownPanelWidth, PANEL_KEY_STEP } from './side-panel'

describe('shownPanelWidth (#55 D4)', () => {
  it('shows the saved width while it fits in half the window', () => {
    expect(shownPanelWidth(280, 1280)).toBe(280)
    expect(shownPanelWidth(640, 1280)).toBe(640)
  })

  it('shows a larger saved width at half the window, rounded down', () => {
    expect(shownPanelWidth(900, 1281)).toBe(640)
  })

  it('never goes below 200, even in a narrow window', () => {
    expect(shownPanelWidth(200, 300)).toBe(200)
  })
})

describe('draggedPanelWidth (#55 D4, AC4)', () => {
  it('widens by how far the left edge moved left', () => {
    expect(draggedPanelWidth(280, 120, 1280)).toBe(400)
    expect(draggedPanelWidth(280, -40, 1280)).toBe(240)
  })

  it('stops at 200 and at half the window', () => {
    expect(draggedPanelWidth(280, -5000, 1280)).toBe(200)
    expect(draggedPanelWidth(280, 5000, 1280)).toBe(640)
    expect(draggedPanelWidth(280, 5000, 300)).toBe(200)
  })

  it('moves 16 px per arrow key', () => {
    expect(PANEL_KEY_STEP).toBe(16)
  })
})
