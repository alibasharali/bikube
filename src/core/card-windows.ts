/** Main's decision on a page's `window.open` and the card window's options (#53 D3). Plain TS. */

import { CARD_WINDOW_PREFIX } from './card-window-name'
import { isCardId } from './ipc-guards'

/** A `window.open` as main's open handler sees it. */
export interface OpenRequest {
  url: string
  frameName: string
  /** The opener is the main window's page (never a card window). */
  fromMainWindow: boolean
}

/**
 * The card id of an allowed card window: only the main window's `about:blank` named
 * `drovr-card:<card id>`, the id passing `isCardId`; null denies it (D3).
 */
export function cardWindowOpen({ url, frameName, fromMainWindow }: OpenRequest): string | null {
  if (!fromMainWindow || url !== 'about:blank' || !frameName.startsWith(CARD_WINDOW_PREFIX)) {
    return null
  }
  const cardId = frameName.slice(CARD_WINDOW_PREFIX.length)
  return isCardId(cardId) ? cardId : null
}

/** A card window's options (as Electron's `BrowserWindowConstructorOptions` takes them). */
export interface CardWindowOptions {
  width: number
  height: number
  backgroundColor: string
  autoHideMenuBar: boolean
  webPreferences: {
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    preload: undefined
  }
}

/**
 * 900×640, placed by the OS, with the main window's background; the menu bar hidden off macOS
 * as in the main window, the standard title bar on macOS; isolated, sandboxed and with no preload,
 * so no `window.drovr` in it (D3).
 */
export function cardWindowOptions(platform: string, backgroundColor: string): CardWindowOptions {
  return {
    width: 900,
    height: 640,
    backgroundColor,
    autoHideMenuBar: platform !== 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: undefined
    }
  }
}
