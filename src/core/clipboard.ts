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

export async function pasteFromClipboard(
  target: PasteTarget,
  clipboard: ClipboardBridge
): Promise<void> {
  const text = await clipboard.read()
  if (text) target.paste(text)
}
