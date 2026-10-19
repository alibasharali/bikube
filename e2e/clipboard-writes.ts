import type { ElectronApplication } from '@playwright/test'

/**
 * Records each text the app writes to the clipboard from now on, still writing it: the system
 * clipboard is shared by every test on xvfb's display, so the tests read what this app wrote.
 * Main looks `clipboard.writeText` up at each write.
 */
export const recordClipboardWrites = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ clipboard }) => {
    const writes: string[] = []
    const write = clipboard.writeText.bind(clipboard)
    Object.assign(globalThis, { __clipboardWrites: writes })
    clipboard.writeText = (text: string, type?: 'selection' | 'clipboard') => {
      writes.push(text)
      write(text, type)
    }
  })

/** The texts the app wrote to the clipboard since `recordClipboardWrites`. */
export const clipboardWrites = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [
    ...(globalThis as unknown as { __clipboardWrites: string[] }).__clipboardWrites
  ])
