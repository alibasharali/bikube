import { app, screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  WINDOW_FILE_NAME,
  WINDOW_SAVE_DELAY_MS,
  parseWindowState,
  serializeWindowState,
  windowPlacement,
  type WindowPlacement,
  type WindowState
} from '../core/window-state'

const filePath = (): string => join(app.getPath('userData'), WINDOW_FILE_NAME)

/** Where the main window opens (#66 D8): the saved state if it fits a display, else the default. */
export function savedPlacement(): WindowPlacement {
  let saved: WindowState | null = null
  try {
    saved = parseWindowState(readFileSync(filePath(), 'utf8'))
  } catch {
    // Missing or unreadable: the default size.
  }
  return windowPlacement(
    saved,
    screen.getAllDisplays().map((display) => display.workArea)
  )
}

/** The size and place options for the main window's constructor. */
export function placementOptions(placement: WindowPlacement): BrowserWindowConstructorOptions {
  return {
    ...(placement.bounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height
  }
}

function write(state: WindowState): void {
  const path = filePath()
  try {
    writeFileSync(`${path}.tmp`, serializeWindowState(state), 'utf8')
    renameSync(`${path}.tmp`, path)
  } catch (err) {
    console.error(`window state not saved: ${String(err)}`)
  }
}

/**
 * Maximizes or makes full screen a window saved that way (#66 D8); call just before showing it,
 * since either shows a hidden window.
 */
export function restoreWindowMode(window: BrowserWindow, placement: WindowPlacement): void {
  if (placement.maximized) window.maximize()
  if (placement.fullScreen) window.setFullScreen(true)
}

/**
 * Keeps the window's state in the file: when it closes, and 500 ms after a move, resize or change
 * of mode, so a crash or SIGKILL keeps the last one (#66 D8).
 */
export function keepWindowState(window: BrowserWindow): void {
  const current = (): WindowState => ({
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen()
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!window.isDestroyed()) write(current())
    }, WINDOW_SAVE_DELAY_MS)
  }
  for (const event of [
    'move',
    'resize',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen'
  ] as const) {
    window.on(event as 'move', later)
  }
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    timer = null
    write(current())
  })
}
