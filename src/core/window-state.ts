/**
 * The main window's saved size and place (#66 D8): `<userData>/bikube-window.json`, this machine's
 * only, never synced. Plain TS: main reads and writes the file and asks Electron for the displays.
 */

export const WINDOW_FILE_NAME = 'bikube-window.json'

/** The size a window opens at, centred, without a usable saved state. */
export const DEFAULT_WINDOW_SIZE = { width: 1100, height: 720 } as const

/** The main window's minimum size; saved sizes below it are raised to it. */
export const MIN_WINDOW_SIZE = { width: 320, height: 240 } as const

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

/** The part of Electron's `BrowserWindow` the mode restore and tracking use. */
export interface ModalWindow {
  getNormalBounds(): Rect
  isMaximized(): boolean
  isFullScreen(): boolean
  isMinimized(): boolean
  isDestroyed(): boolean
  maximize(): void
  setFullScreen(flag: boolean): void
  on(event: 'close' | 'move' | 'resize' | (string & {}), listener: () => void): unknown
}

/**
 * Maximizes or makes full screen a window saved that way (#66 D8); call just before showing it,
 * since either shows a hidden window.
 */
export function restoreWindowMode(
  window: Pick<ModalWindow, 'maximize' | 'setFullScreen'>,
  placement: Pick<WindowPlacement, 'maximized' | 'fullScreen'>
): void {
  if (placement.maximized) window.maximize()
  if (placement.fullScreen) window.setFullScreen(true)
}

const TRACKED_EVENTS = [
  'move',
  'resize',
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen',
  'minimize',
  'restore'
] as const

/**
 * Hands `save` the window's state when it closes, and 500 ms after a move, resize or change of
 * mode, so a crash or SIGKILL keeps the last one (#66 D8). A minimized window may read as neither
 * maximized nor full screen, so while it is minimized the mode last seen before is saved.
 */
export function trackWindowState(window: ModalWindow, save: (state: WindowState) => void): void {
  let mode = { maximized: window.isMaximized(), fullScreen: window.isFullScreen() }
  const current = (): WindowState => {
    if (!window.isMinimized()) {
      mode = { maximized: window.isMaximized(), fullScreen: window.isFullScreen() }
    }
    return { bounds: window.getNormalBounds(), ...mode }
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = (): void => {
    // Read the mode now: by the time the delay ends the window may have been minimized.
    current()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!window.isDestroyed()) save(current())
    }, WINDOW_SAVE_DELAY_MS)
  }
  for (const event of TRACKED_EVENTS) window.on(event, later)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    timer = null
    save(current())
  })
}
