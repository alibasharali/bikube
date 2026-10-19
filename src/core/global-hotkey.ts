/**
 * The global shortcut (#51), free of Electron and DOM imports: its Electron accelerator (D7) and
 * the rules a recorded or saved one must meet (D5, D9).
 */
import {
  isShortcutText,
  modifierMessage,
  recordedShortcut,
  shortcutOwner,
  type KeyEventLike,
  type Keymap,
  type RecordResult
} from './keymap'

/** The refusal for a key Electron can't register globally (D5). */
export const NO_ACCELERATOR_MESSAGE = "Can't be a global shortcut"

const NAMED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  '+': 'Plus'
})

/** The accelerator's key for D7's key: letters, digits, F1–F24, D7's named keys and ASCII punctuation. */
function acceleratorKey(key: string): string | null {
  if (Object.hasOwn(NAMED_KEYS, key)) return NAMED_KEYS[key]
  if (/^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  // Printable ASCII punctuation as is (`+` is Plus above).
  if (/^[!-/:-@[-`{-~]$/.test(key)) return key
  return null
}

const MODIFIER_NAMES = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const

/**
 * Electron's accelerator for `text` (#51 D7): `Cmd` is `Command` on macOS and `Super` elsewhere,
 * `Ctrl` is `Control`; null when the text isn't a shortcut or its key has none. The modifiers may
 * come in any order, each once.
 */
export function globalAccelerator(text: string, platform: string): string | null {
  let key: string
  let head: string
  if (text.endsWith('++')) {
    key = '+'
    head = text.slice(0, -2)
  } else {
    const at = text.lastIndexOf('+')
    key = text.slice(at + 1)
    head = at < 0 ? '' : text.slice(0, at)
  }
  const accelKey = acceleratorKey(key)
  if (accelKey === null) return null
  const names = head === '' ? [] : head.split('+')
  if (new Set(names).size !== names.length) return null
  if (!names.every((name) => (MODIFIER_NAMES as readonly string[]).includes(name))) return null
  const parts: string[] = []
  if (names.includes('Cmd')) parts.push(platform === 'darwin' ? 'Command' : 'Super')
  if (names.includes('Ctrl')) parts.push('Control')
  if (names.includes('Alt')) parts.push('Alt')
  if (names.includes('Shift')) parts.push('Shift')
  parts.push(accelKey)
  return parts.join('+')
}

/**
 * Why `text` can't be the global shortcut (D5, D9), or null when it can: not D7 text with Cmd,
 * Ctrl or Alt, a fixed shortcut or one of `keymap`'s (`Already used by <name>`), or no
 * accelerator (D7).
 */
export function globalShortcutRefusal(
  text: string,
  keymap: Keymap,
  platform: string
): string | null {
  if (!isShortcutText(text)) return modifierMessage(platform)
  const owner = shortcutOwner(text, null, keymap, platform)
  if (owner !== undefined) return `Already used by ${owner}`
  if (globalAccelerator(text, platform) === null) return NO_ACCELERATOR_MESSAGE
  return null
}

/** Whether `value` may be the global shortcut beside the in-app `keymap` (D9). */
export function isGlobalShortcut(
  value: unknown,
  keymap: Keymap,
  platform: string
): value is string {
  return typeof value === 'string' && globalShortcutRefusal(value, keymap, platform) === null
}

/**
 * The outcome of a press while the Global field records (D5): as an in-app field's (#31 D8), and
 * a shortcut any in-app action holds or with no accelerator is refused too.
 */
export function recordGlobalPress(
  event: KeyEventLike,
  keymap: Keymap,
  platform: string
): RecordResult {
  const recorded = recordedShortcut(event, platform)
  if (recorded.kind !== 'shortcut') return recorded
  const message = globalShortcutRefusal(recorded.shortcut, keymap, platform)
  if (message !== null) return { kind: 'refused', message }
  return { kind: 'set', shortcut: recorded.shortcut }
}
