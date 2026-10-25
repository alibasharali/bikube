import { app, screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  WINDOW_FILE_NAME,
  parseWindowState,
  serializeWindowState,
  trackWindowState,
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

export { restoreWindowMode } from '../core/window-state'

/** Keeps the window's state in the file (#66 D8): see `trackWindowState`. */
export function keepWindowState(window: BrowserWindow): void {
  trackWindowState(window, write)
}
