import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  parseWindowState,
  serializeWindowState,
  windowPlacement,
  type WindowState
} from './window-state'

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 }
const RIGHT_SCREEN = { x: 1920, y: 0, width: 1280, height: 1000 }

const state = (over: Partial<WindowState> = {}): WindowState => ({
  bounds: { x: 60, y: 40, width: 900, height: 650 },
  maximized: false,
  fullScreen: false,
  ...over
})

describe('window state file (#66 D8)', () => {
  it('round-trips through its file format', () => {
    const saved = state({ maximized: true })
    const text = serializeWindowState(saved)
    expect(JSON.parse(text)).toEqual({ version: 1, ...saved })
    expect(parseWindowState(text)).toEqual(saved)
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['another version', JSON.stringify({ version: 2, ...state() })],
    ['no bounds', JSON.stringify({ version: 1, maximized: false, fullScreen: false })],
    [
      'a bound that is no number',
      JSON.stringify({ version: 1, ...state(), bounds: { x: 'a', y: 0, width: 900, height: 650 } })
    ],
    [
      'an infinite bound',
      '{"version":1,"bounds":{"x":1e999,"y":0,"width":900,"height":650},"maximized":false,"fullScreen":false}'
    ],
    [
      'a size of zero',
      JSON.stringify({ version: 1, ...state(), bounds: { x: 0, y: 0, width: 0, height: 650 } })
    ],
    ['an array', '[]'],
    ['null', 'null']
  ])('reads %s as no saved state', (_name, text) => {
    expect(parseWindowState(text)).toBeNull()
  })

  it('reads missing or odd flags as false and rounds the bounds', () => {
    const text = JSON.stringify({
      version: 1,
      bounds: { x: 60.4, y: 40.6, width: 900, height: 650 },
      maximized: 'yes'
    })
    expect(parseWindowState(text)).toEqual(
      state({ bounds: { x: 60, y: 41, width: 900, height: 650 } })
    )
  })
})

describe('window placement at launch (#66 D8)', () => {
  it('opens at the default size, centred, without a saved state', () => {
    expect(windowPlacement(null, [SCREEN])).toEqual({
      bounds: null,
      maximized: false,
      fullScreen: false
    })
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1100, height: 720 })
  })

  it('uses the saved bounds and flags when they lie on a display', () => {
    expect(windowPlacement(state({ maximized: true }), [SCREEN])).toEqual(
      state({ maximized: true })
    )
    expect(windowPlacement(state({ fullScreen: true }), [SCREEN]).fullScreen).toBe(true)
  })

  it('uses bounds on a second display', () => {
    const onRight = state({ bounds: { x: 2000, y: 100, width: 900, height: 650 } })
    expect(windowPlacement(onRight, [SCREEN, RIGHT_SCREEN])).toEqual(onRight)
  })

  it('falls back to the default when the bounds lie outside every display', () => {
    const gone = state({ bounds: { x: 2000, y: 100, width: 900, height: 650 }, maximized: true })
    expect(windowPlacement(gone, [SCREEN])).toEqual({
      bounds: null,
      maximized: false,
      fullScreen: false
    })
  })

  it('needs at least 100×50 px of the window on one display', () => {
    const at = (x: number, y: number): WindowState =>
      state({ bounds: { x, y, width: 900, height: 650 } })
    // 100 px wide on screen at the right edge, 50 px tall at the bottom.
    expect(windowPlacement(at(1920 - 100, 0), [SCREEN]).bounds).not.toBeNull()
    expect(windowPlacement(at(1920 - 99, 0), [SCREEN]).bounds).toBeNull()
    expect(windowPlacement(at(0, 1040 - 50), [SCREEN]).bounds).not.toBeNull()
    expect(windowPlacement(at(0, 1040 - 49), [SCREEN]).bounds).toBeNull()
    expect(windowPlacement(at(-900 + 100, -650 + 50), [SCREEN]).bounds).not.toBeNull()
  })

  it('does not add up pieces on two displays', () => {
    // A window off the bottom with 40 px left above it, half on each display: neither holds 50 px.
    const tall = { ...RIGHT_SCREEN, height: 1040 }
    const seam = state({ bounds: { x: 1920 - 450, y: 1000, width: 900, height: 650 } })
    expect(windowPlacement(seam, [SCREEN, tall]).bounds).toBeNull()
    // Neither display holds 100 px of its width, together they do.
    const across = state({ bounds: { x: 1920 - 90, y: 0, width: 400, height: 400 } })
    expect(
      windowPlacement(across, [SCREEN, { x: 1920, y: 400 - 40, width: 1280, height: 1000 }]).bounds
    ).toBeNull()
  })

  it('raises a size below the minimum to it', () => {
    expect(MIN_WINDOW_SIZE).toEqual({ width: 400, height: 300 })
    const small = state({ bounds: { x: 10, y: 20, width: 200, height: 100 } })
    expect(windowPlacement(small, [SCREEN]).bounds).toEqual({
      x: 10,
      y: 20,
      width: 400,
      height: 300
    })
  })

  it('falls back to the default with no display', () => {
    expect(windowPlacement(state(), []).bounds).toBeNull()
  })
})
