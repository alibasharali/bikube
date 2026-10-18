/**
 * The configurable shortcuts (#31 D5–D9), free of DOM imports: each OS's defaults, the text
 * format (`Ctrl+Alt+Shift+Cmd+Key`), reading a key event, matching, the refusal rules of the
 * Settings recorder and reading and checking the saved set.
 */
import type { KeyLike } from './clipboard'

export const SHORTCUT_ACTIONS = [
  'back',
  'splitRight',
  'splitDown',
  'closePane',
  'closeCard',
  'settings',
  'openShell',
  'togglePanel',
  'find'
] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

/** Every action's shortcut, as D7 text. */
export type Keymap = Record<ShortcutAction, string>

/** A key event as the keymap reads it; `code` is the physical key, `repeat` an auto-repeat. */
export interface KeyEventLike extends KeyLike {
  code?: string
  repeat?: boolean
}

const MAC_DEFAULTS: Readonly<Keymap> = Object.freeze({
  back: 'Shift+Cmd+B',
  splitRight: 'Cmd+D',
  splitDown: 'Shift+Cmd+D',
  closePane: 'Cmd+W',
  closeCard: 'Shift+Cmd+W',
  settings: 'Cmd+,',
  openShell: 'Cmd+T',
  togglePanel: 'Alt+Cmd+B',
  find: 'Cmd+F'
})

const OTHER_DEFAULTS: Readonly<Keymap> = Object.freeze({
  back: 'Ctrl+Shift+B',
  splitRight: 'Ctrl+Shift+D',
  splitDown: 'Ctrl+Shift+E',
  closePane: 'Ctrl+Shift+W',
  closeCard: 'Ctrl+Shift+Q',
  settings: 'Ctrl+,',
  openShell: 'Ctrl+Shift+T',
  togglePanel: 'Ctrl+Alt+B',
  // Not Ctrl+F: it stays the shell's (readline's forward-char) (#35 D2).
  find: 'Ctrl+Shift+F'
})

/** This OS's default shortcuts (D6). */
export function defaultKeymap(platform: string): Keymap {
  return { ...(platform === 'darwin' ? MAC_DEFAULTS : OTHER_DEFAULTS) }
}

/** A shortcut's parts; `key` as D7 writes it. */
export interface Shortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  cmd: boolean
  key: string
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const

/** Keys that are modifiers or no key at all: pressed alone they make no shortcut. */
const NOT_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'OS',
  'Dead',
  'Unidentified',
  'Process',
  ...MODIFIERS
])

const NAMED_KEY = /^[A-Z][A-Za-z0-9]+$/

/** Whether `key` is a key as D7 writes it: one printable character (letters upper-cased) or a named key. */
function isKeyText(key: string): boolean {
  const chars = [...key]
  if (chars.length === 1) {
    return !/[\s\p{C}]/u.test(key) && key === key.toUpperCase()
  }
  return NAMED_KEY.test(key) && !NOT_KEYS.has(key)
}

/**
 * The key of a press as D7 writes it, or null for a modifier alone. The typed character when it is
 * one printable ASCII character (AZERTY's `,` on the M key stays `,`); else (a dead key, macOS
 * Option+R typing ®, a non-Latin letter) the physical letter or digit key.
 */
export function eventKey(event: KeyEventLike): string | null {
  const { key } = event
  if (/^[!-~]$/.test(key)) return key.toUpperCase()
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? '')
  if (physical) return physical[1] ?? physical[2]
  if (key === ' ') return 'Space'
  const upper = [...key].length === 1 ? key.toUpperCase() : key
  return isKeyText(upper) ? upper : null
}

/** The parts of D7 text, or null when it isn't one (modifiers out of order or repeated, bad key). */
export function parseShortcut(text: string): Shortcut | null {
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
  if (!isKeyText(key)) return null
  const names = head === '' ? [] : head.split('+')
  let last = -1
  for (const name of names) {
    const index = (MODIFIERS as readonly string[]).indexOf(name)
    if (index <= last) return null
    last = index
  }
  return {
    ctrl: names.includes('Ctrl'),
    alt: names.includes('Alt'),
    shift: names.includes('Shift'),
    cmd: names.includes('Cmd'),
    key
  }
}

/** D7 text for `shortcut`: the modifiers in the fixed order, then the key, joined with `+`. */
export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.cmd) parts.push('Cmd')
  parts.push(shortcut.key)
  return parts.join('+')
}

/**
 * Whether the press is exactly `text`: every listed modifier pressed and no other, the key
 * compared case-insensitively. Matches every event type, so the whole key can be swallowed.
 */
export function matchesShortcut(event: KeyEventLike, text: string): boolean {
  const shortcut = parseShortcut(text)
  if (!shortcut) return false
  if (
    event.ctrlKey !== shortcut.ctrl ||
    event.altKey !== shortcut.alt ||
    event.shiftKey !== shortcut.shift ||
    event.metaKey !== shortcut.cmd
  ) {
    return false
  }
  return eventKey(event)?.toUpperCase() === shortcut.key.toUpperCase()
}

/** The action whose shortcut the press is, or null. */
export function keymapAction(event: KeyEventLike, keymap: Keymap): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((action) => matchesShortcut(event, keymap[action])) ?? null
}

/**
 * The workspace number of a Mod+digit press (D18): Cmd+1…9 on macOS, Ctrl+1…9 elsewhere, read
 * from the physical digit key so any layout works, with no other modifier; else null. Matches
 * every event type, so the whole key can be swallowed.
 */
export function workspaceShortcut(event: KeyEventLike, platform: string): number | null {
  const mac = platform === 'darwin'
  if (event.metaKey !== mac || event.ctrlKey === mac || event.altKey || event.shiftKey) return null
  const digit = /^Digit([1-9])$/.exec(event.code ?? '')
  return digit ? Number(digit[1]) : null
}

/** Each action's name in Settings and in refusals (D5). */
export const SHORTCUT_LABELS: Readonly<Record<ShortcutAction, string>> = Object.freeze({
  back: 'Back to board',
  splitRight: 'Split right',
  splitDown: 'Split down',
  closePane: 'Close pane',
  closeCard: 'Close card',
  settings: 'Open Settings',
  openShell: 'Open Default shell',
  togglePanel: 'Toggle panel',
  find: 'Find'
})

/** The app menu's accelerators on each OS (#14 D9, Electron's roles), as D7 text (D8). */
function menuAccelerators(platform: string): [string, string][] {
  if (platform === 'darwin') {
    return [
      ['Alt+Cmd+H', 'Hide Others'],
      ['Cmd+Z', 'Undo'],
      ['Shift+Cmd+Z', 'Redo'],
      ['Cmd+X', 'Cut'],
      ['Alt+Shift+Cmd+V', 'Paste and Match Style'],
      ['Cmd+A', 'Select All'],
      ['Cmd+R', 'Reload'],
      ['Shift+Cmd+R', 'Force Reload'],
      ['Alt+Cmd+I', 'Toggle Developer Tools'],
      ['Cmd+0', 'Actual Size'],
      ['Cmd++', 'Zoom In'],
      ['Shift+Cmd++', 'Zoom In'],
      ['Cmd+=', 'Zoom In'],
      ['Cmd+-', 'Zoom Out'],
      ['Ctrl+Cmd+F', 'Toggle Full Screen']
    ]
  }
  return [
    ['Ctrl+Q', 'Quit'],
    ['Ctrl+Z', 'Undo'],
    [platform === 'win32' ? 'Ctrl+Y' : 'Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+X', 'Cut'],
    ['Ctrl+C', 'Copy'],
    ['Ctrl+V', 'Paste'],
    ['Ctrl+A', 'Select All'],
    ['Ctrl+R', 'Reload'],
    ['Ctrl+Shift+R', 'Force Reload'],
    ['Ctrl+Shift+I', 'Toggle Developer Tools'],
    ['Ctrl+0', 'Actual Size'],
    ['Ctrl++', 'Zoom In'],
    ['Ctrl+Shift++', 'Zoom In'],
    ['Ctrl+=', 'Zoom In'],
    ['Ctrl+-', 'Zoom Out'],
    ['Ctrl+M', 'Minimize'],
    ['Ctrl+W', 'Close Window']
  ]
}

/**
 * The fixed shortcuts a configurable one can't take (D8), as D7 text, with what they do: card
 * moves, copy and paste, workspace switching (D18), on macOS Quit, Hide and Minimize, and the app
 * menu's accelerators.
 */
export function fixedShortcuts(platform: string): ReadonlyMap<string, string> {
  const mac = platform === 'darwin'
  const mod = mac ? 'Cmd' : 'Ctrl'
  const fixed = new Map<string, string>()
  for (const arrow of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    fixed.set(`Alt+${arrow}`, 'Move card')
  }
  fixed.set(mac ? 'Cmd+C' : 'Ctrl+Shift+C', 'Copy')
  fixed.set(mac ? 'Cmd+V' : 'Ctrl+Shift+V', 'Paste')
  for (let digit = 1; digit <= 9; digit++) fixed.set(`${mod}+${digit}`, 'Switch workspace')
  if (mac) {
    fixed.set('Cmd+Q', 'Quit')
    fixed.set('Cmd+H', 'Hide')
    fixed.set('Cmd+M', 'Minimize')
  }
  for (const [shortcut, name] of menuAccelerators(platform)) {
    if (!fixed.has(shortcut)) fixed.set(shortcut, name)
  }
  return fixed
}

/** What a press does while a Settings field records `action`'s shortcut (D8). */
export type RecordResult =
  | { kind: 'ignore' }
  | { kind: 'cancel' }
  | { kind: 'refused'; message: string }
  | { kind: 'set'; shortcut: string }

/** The refusal for a key pressed without Cmd, Ctrl or Alt (D8). */
export function modifierMessage(platform: string): string {
  return `Use ${platform === 'darwin' ? 'Cmd' : 'Ctrl'} or Alt with a key`
}

/**
 * The outcome of a press while `action`'s field records (D8): a modifier alone keeps recording,
 * Escape cancels, a key without Cmd, Ctrl or Alt or a combination already used (a fixed shortcut
 * or another action's in `keymap`) is refused, anything else is the new shortcut.
 */
export function recordPress(
  event: KeyEventLike,
  action: ShortcutAction,
  keymap: Keymap,
  platform: string
): RecordResult {
  const commanded = event.ctrlKey || event.altKey || event.metaKey
  if (event.key === 'Escape' && !commanded) return { kind: 'cancel' }
  const key = eventKey(event)
  if (key === null) return { kind: 'ignore' }
  if (!commanded) return { kind: 'refused', message: modifierMessage(platform) }
  const shortcut = formatShortcut({
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    cmd: event.metaKey,
    key
  })
  const owner = shortcutOwner(shortcut, action, keymap, platform)
  if (owner !== undefined) return { kind: 'refused', message: `Already used by ${owner}` }
  return { kind: 'set', shortcut }
}

/** What else holds `shortcut` (a fixed shortcut or another action), named as D8 shows it. */
function shortcutOwner(
  shortcut: string,
  action: ShortcutAction,
  keymap: Keymap,
  platform: string
): string | undefined {
  return (
    fixedShortcuts(platform).get(shortcut) ??
    SHORTCUT_ACTIONS.filter((other) => other !== action && keymap[other] === shortcut).map(
      (other) => SHORTCUT_LABELS[other]
    )[0]
  )
}

/**
 * Why Reset can't bring back `action`'s default (D8): another action holds it now, e.g.
 * `Already used by Split right`; null when Reset may apply it.
 */
export function resetRefusal(
  action: ShortcutAction,
  keymap: Keymap,
  platform: string
): string | null {
  const owner = shortcutOwner(defaultKeymap(platform)[action], action, keymap, platform)
  return owner === undefined ? null : `Already used by ${owner}`
}

/** The shortcuts that differ from this OS's default, keyed by action (D9). */
export type ShortcutOverrides = Partial<Record<ShortcutAction, string>>

/** Whether `text` is a shortcut a configurable action may have: D7 text with Cmd, Ctrl or Alt. */
export function isShortcutText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const shortcut = parseShortcut(value)
  return shortcut !== null && (shortcut.ctrl || shortcut.alt || shortcut.cmd)
}

/** Whether a configurable action may have `value` on this OS: shortcut text that isn't fixed (D9). */
function isFreeShortcut(value: unknown, platform: string): value is string {
  return isShortcutText(value) && !fixedShortcuts(platform).has(value)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every action's shortcut: `overrides` laid over this OS's defaults. */
export function resolveKeymap(overrides: ShortcutOverrides | undefined, platform: string): Keymap {
  return { ...defaultKeymap(platform), ...overrides }
}

/** The entries of `keymap` that differ from this OS's defaults, in action order. */
export function shortcutOverrides(keymap: Keymap, platform: string): ShortcutOverrides {
  const defaults = defaultKeymap(platform)
  const overrides: ShortcutOverrides = {}
  for (const action of SHORTCUT_ACTIONS) {
    if (keymap[action] !== defaults[action]) overrides[action] = keymap[action]
  }
  return overrides
}

/** The actions whose shortcut another action has too. */
function sharedActions(keymap: Keymap): ShortcutAction[] {
  return SHORTCUT_ACTIONS.filter((action) =>
    SHORTCUT_ACTIONS.some((other) => other !== action && keymap[other] === keymap[action])
  )
}

/**
 * Reads the settings file's `shortcuts` (D9) per entry: a missing, malformed, modifier-less or fixed entry
 * takes the default, two actions with the same shortcut both do, unknown keys are ignored and
 * anything but an object gives all defaults. `dropped` lists the entries that fell back.
 */
export function readShortcuts(
  raw: unknown,
  platform: string
): { shortcuts: ShortcutOverrides; dropped: ShortcutAction[] } {
  const defaults = defaultKeymap(platform)
  const keymap = { ...defaults }
  const dropped = new Set<ShortcutAction>()
  if (!isObject(raw)) return { shortcuts: {}, dropped: [] }
  for (const action of SHORTCUT_ACTIONS) {
    if (!(action in raw)) continue
    const value = raw[action]
    if (isFreeShortcut(value, platform)) keymap[action] = value
    else dropped.add(action)
  }
  // A fallback may take a shortcut another entry has: repeat until no two share one. Defaults
  // never share, so this ends.
  for (let shared = sharedActions(keymap); shared.length > 0; shared = sharedActions(keymap)) {
    for (const action of shared) {
      if (keymap[action] !== defaults[action]) dropped.add(action)
      keymap[action] = defaults[action]
    }
  }
  return {
    shortcuts: shortcutOverrides(keymap, platform),
    dropped: SHORTCUT_ACTIONS.filter((action) => dropped.has(action))
  }
}

/**
 * Checks a whole set of shortcuts being saved (D9): null when an entry is unknown, invalid or fixed or two
 * actions share a shortcut; else the entries that differ from the default. Absent means none.
 */
export function validateShortcuts(raw: unknown, platform: string): ShortcutOverrides | null {
  if (raw === undefined) return {}
  if (!isObject(raw)) return null
  const keymap = defaultKeymap(platform)
  for (const [action, value] of Object.entries(raw)) {
    if (
      !(SHORTCUT_ACTIONS as readonly string[]).includes(action) ||
      !isFreeShortcut(value, platform)
    ) {
      return null
    }
    keymap[action as ShortcutAction] = value
  }
  if (sharedActions(keymap).length > 0) return null
  return shortcutOverrides(keymap, platform)
}
