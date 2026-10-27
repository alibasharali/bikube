/** Enter in a dialog with a multi-line field (#69 D3, D4). Plain TS, no DOM. */

export interface DialogKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
  /** Where it was pressed: a one-line field, a select, the multi-line field, anything else. */
  target: 'input' | 'select' | 'textarea' | 'other'
}

/**
 * `submit` for Mod+Enter anywhere in the dialog (Cmd on macOS, Ctrl elsewhere) and for a plain
 * Enter in a one-line field or a select; null otherwise, so Enter in the multi-line field types a
 * new line and Enter on a button presses it.
 */
export function dialogEnterAction(e: DialogKey, platform: string): 'submit' | null {
  if (e.key !== 'Enter' || e.isComposing || e.altKey || e.shiftKey) return null
  const mod = platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (mod) return 'submit'
  if (e.metaKey || e.ctrlKey) return null
  return e.target === 'input' || e.target === 'select' ? 'submit' : null
}

/** The `target` of a DOM key event for `dialogEnterAction`. */
export function dialogKeyTarget(target: EventTarget | null): DialogKey['target'] {
  const tag = (target as { tagName?: string } | null)?.tagName
  return tag === 'INPUT'
    ? 'input'
    : tag === 'SELECT'
      ? 'select'
      : tag === 'TEXTAREA'
        ? 'textarea'
        : 'other'
}
