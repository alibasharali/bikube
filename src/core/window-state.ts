/**
 * The main window's saved size and place (#66 D8): `<userData>/bikube-window.json`, this machine's
 * only, never synced. Plain TS: main reads and writes the file and asks Electron for the displays.
 */

export const WINDOW_FILE_NAME = 'bikube-window.json'

/** The size a window opens at, centred, without a usable saved state. */
export const DEFAULT_WINDOW_SIZE = { width: 1100, height: 720 } as const

/** The main window's minimum size; saved sizes below it are raised to it. */
export const MIN_WINDOW_SIZE = { width: 400, height: 300 } as const

/** How much of the saved window must lie within one display's work area for it to be used. */
const MIN_VISIBLE = { width: 100, height: 50 } as const

/** How long main waits after a move or resize before writing the file. */
export const WINDOW_SAVE_DELAY_MS = 500

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  /** The window's normal bounds: its size and place when neither maximized nor full screen. */
  bounds: Rect
  maximized: boolean
  fullScreen: boolean
}

export interface WindowPlacement {
  /** The bounds to open with, or null for the default size, centred. */
  bounds: Rect | null
  maximized: boolean
  fullScreen: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function readRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) => value[key])
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const rect = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number)
  }
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** The file's state, or null when it is invalid JSON or not version 1 with valid bounds. */
export function parseWindowState(text: string): WindowState | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value['version'] !== 1) return null
  const bounds = readRect(value['bounds'])
  if (!bounds) return null
  return {
    bounds,
    maximized: value['maximized'] === true,
    fullScreen: value['fullScreen'] === true
  }
}

export function serializeWindowState(state: WindowState): string {
  return `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`
}

const overlap = (a: Rect, b: Rect): { width: number; height: number } => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
})

/**
 * Where the main window opens: the saved bounds (raised to the minimum size) and flags when at
 * least 100×50 px of them lies within one of `workAreas`, else the default size, centred.
 */
export function windowPlacement(state: WindowState | null, workAreas: Rect[]): WindowPlacement {
  const fallback = { bounds: null, maximized: false, fullScreen: false }
  if (!state) return fallback
  const bounds = {
    ...state.bounds,
    width: Math.max(state.bounds.width, MIN_WINDOW_SIZE.width),
    height: Math.max(state.bounds.height, MIN_WINDOW_SIZE.height)
  }
  const visible = workAreas.some((area) => {
    const shared = overlap(bounds, area)
    return shared.width >= MIN_VISIBLE.width && shared.height >= MIN_VISIBLE.height
  })
  if (!visible) return fallback
  return { bounds, maximized: state.maximized, fullScreen: state.fullScreen }
}
