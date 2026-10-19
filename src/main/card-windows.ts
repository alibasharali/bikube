import { BrowserWindow, ipcMain } from 'electron'
import { cardWindowOpen, cardWindowOptions } from '../core/card-windows'
import { isCardId } from '../core/ipc-guards'
import { IPC } from '../shared/api'

/** The open card windows by card (or shell) id (#53 D3), runtime only (D9). */
const cardWindows = new Map<string, BrowserWindow>()

/** Whether `window` is one of the card windows. */
const isCardWindow = (window: BrowserWindow): boolean => [...cardWindows.values()].includes(window)

/**
 * The main window, never a card window: what a second launch, the global shortcut (#51) and the
 * dock bring forward (#53 D3). Undefined while there is none.
 */
export function appWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => !isCardWindow(window))
}

/**
 * Lets the main window's page open its card windows (#53 D2, D3): `about:blank` named
 * `drovr-card:<card id>`, one per card, with `cardWindowOptions`; every other open stays denied,
 * as it is for every other web contents (card windows included). Main keeps them by card id and
 * closes them all when the main window closes, its page navigates (a reload) or its renderer is
 * gone: the page that draws them must not be outlived.
 */
export function allowCardWindows(mainWindow: BrowserWindow, backgroundColor: () => string): void {
  const contents = mainWindow.webContents
  const cardIdOf = (details: { url: string; frameName: string }): string | null =>
    cardWindowOpen({ url: details.url, frameName: details.frameName, fromMainWindow: true })

  contents.setWindowOpenHandler((details) => {
    const cardId = cardIdOf(details)
    if (cardId === null || cardWindows.has(cardId)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: cardWindowOptions(process.platform, backgroundColor())
    }
  })
  contents.on('did-create-window', (window, details) => {
    const cardId = cardIdOf(details)
    if (cardId === null || cardWindows.has(cardId)) {
      window.destroy()
      return
    }
    cardWindows.set(cardId, window)
    window.on('closed', () => {
      if (cardWindows.get(cardId) === window) cardWindows.delete(cardId)
    })
  })

  const closeAll = (): void => {
    for (const window of cardWindows.values()) {
      if (!window.isDestroyed()) window.close()
    }
  }
  mainWindow.on('closed', closeAll)
  contents.on('did-navigate', closeAll)
  contents.on('render-process-gone', closeAll)
}

/** `cardWindow:focus` (#53 D3): brings a card's window forward; an unknown id does nothing. */
export function registerCardWindows(): void {
  ipcMain.on(IPC.cardWindowFocus, (event, cardId: unknown) => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return
    if (!isCardId(cardId)) return
    const window = cardWindows.get(cardId)
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}
