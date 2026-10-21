/** Clipboard shortcuts and copy/paste logic for a terminal, free of Electron and DOM imports. */

export interface KeyLike {
  type: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** The clipboard as the renderer sees it: the preload bridge to main. */
export interface ClipboardBridge {
  read(): Promise<string>
  write(text: string): Promise<void>
  /** Whether the clipboard holds an image (a screenshot, a copied picture). */
  hasImage(): Promise<boolean>
}

export interface CopySource {
  hasSelection(): boolean
  getSelection(): string
}

/** xterm's paste wraps the text in bracketed-paste markers when the shell enabled that mode. */
export interface PasteTarget {
  paste(text: string): void
}

/**
 * Cmd+C/V on macOS. Elsewhere Ctrl+Shift+C/V, because plain Ctrl+C is the interrupt (D10).
 */
export function clipboardShortcut(event: KeyLike, platform: string): 'copy' | 'paste' | null {
  if (event.type !== 'keydown' || event.altKey) return null
  const mac = platform === 'darwin'
  const modifier = mac
    ? event.metaKey && !event.ctrlKey && !event.shiftKey
    : event.ctrlKey && event.shiftKey && !event.metaKey
  if (!modifier) return null
  const k = event.key.toLowerCase()
  if (k === 'c') return 'copy'
  if (k === 'v') return 'paste'
  return null
}

/** Returns whether anything was copied. */
export async function copySelection(
  source: CopySource,
  clipboard: ClipboardBridge
): Promise<boolean> {
  if (!source.hasSelection()) return false
  await clipboard.write(source.getSelection())
  return true
}

/**
 * Ctrl+V, the key Claude Code pastes an image on: it reads the image from the system clipboard
 * itself (on macOS too, where Cmd+V is the terminal's own text paste).
 */
export const IMAGE_PASTE_KEY = '\x16'

/** A pane that may take an image paste: whether it does now, and how keys reach it. */
export interface ImagePasteTarget {
  accepts(): boolean
  input(data: string): void
}

/**
 * Pastes the clipboard's text; with no text but an image, sends `IMAGE_PASTE_KEY` to a pane
 * that accepts it (Claude Code running there), so Cmd+V pastes a screenshot as it does in other
 * macOS terminals. Anywhere else an image alone pastes nothing.
 */
export async function pasteFromClipboard(
  target: PasteTarget,
  clipboard: ClipboardBridge,
  image?: ImagePasteTarget
): Promise<void> {
  const text = await clipboard.read()
  if (text) {
    target.paste(text)
    return
  }
  if (image?.accepts() && (await clipboard.hasImage())) image.input(IMAGE_PASTE_KEY)
}
