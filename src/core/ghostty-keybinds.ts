/**
 * "Use Ghostty shortcuts": Ghostty's `keybind` lines, laid over its own defaults, turned into
 * Bikube's shortcuts for the actions both have (`GHOSTTY_ACTIONS`). Plain TS, no DOM.
 */
import {
  GLOBAL_SHORTCUT_LABEL,
  fixedShortcuts,
  formatShortcut,
  SHIFTED,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  type Keymap,
  type ShortcutAction
} from './keymap'

/** Ghostty's action (with its parameter) for each Bikube action it has. */
const GHOSTTY_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
  'new_split:right': 'splitRight',
  'new_split:down': 'splitDown',
  'goto_split:next': 'focusNextPane',
  'goto_split:previous': 'focusPreviousPane',
  toggle_split_zoom: 'zoomPane',
  equalize_splits: 'equalizePanes',
  'resize_split:left': 'resizePaneLeft',
  'resize_split:right': 'resizePaneRight',
  'resize_split:up': 'resizePaneUp',
  'resize_split:down': 'resizePaneDown',
  close_surface: 'closePane',
  prompt_surface_title: 'renameCard',
  'jump_to_prompt:-1': 'previousPrompt',
  'jump_to_prompt:1': 'nextPrompt',
  start_search: 'find',
  toggle_command_palette: 'palette',
  open_config: 'settings',
  new_tab: 'openShell'
}

/**
 * Ghostty's default keybinds for those actions, in its order (`ghostty +list-keybinds --default`
 * on macOS, `Config.zig` elsewhere, Ghostty 1.2): a later bind for the same action wins.
 */
const GHOSTTY_DEFAULTS: Readonly<Record<'darwin' | 'other', readonly string[]>> = {
  darwin: [
    'super+,=open_config',
    'super+shift+enter=toggle_split_zoom',
    'super+shift+p=toggle_command_palette',
    'super+shift+arrow_up=jump_to_prompt:-1',
    'super+shift+arrow_down=jump_to_prompt:1',
    'super+w=close_surface',
    'super+t=new_tab',
    'super+d=new_split:right',
    'super+shift+d=new_split:down',
    'super+[=goto_split:previous',
    'super+]=goto_split:next',
    'super+ctrl+arrow_up=resize_split:up,10',
    'super+ctrl+arrow_down=resize_split:down,10',
    'super+ctrl+arrow_left=resize_split:left,10',
    'super+ctrl+arrow_right=resize_split:right,10',
    'super+ctrl+==equalize_splits',
    'super+arrow_up=jump_to_prompt:-1',
    'super+arrow_down=jump_to_prompt:1',
    'super+f=start_search'
  ],
  other: [
    'ctrl+,=open_config',
    'ctrl+shift+w=close_surface',
    'ctrl+shift+t=new_tab',
    'ctrl+shift+o=new_split:right',
    'ctrl+shift+e=new_split:down',
    'ctrl+super+[=goto_split:previous',
    'ctrl+super+]=goto_split:next',
    'super+ctrl+shift+arrow_up=resize_split:up,10',
    'super+ctrl+shift+arrow_down=resize_split:down,10',
    'super+ctrl+shift+arrow_left=resize_split:left,10',
    'super+ctrl+shift+arrow_right=resize_split:right,10',
    'ctrl+shift+arrow_up=jump_to_prompt:-1',
    'ctrl+shift+arrow_down=jump_to_prompt:1',
    'ctrl+shift+f=start_search',
    'ctrl+shift+enter=toggle_split_zoom',
    'ctrl+shift+p=toggle_command_palette'
  ]
}

/** Ghostty's key names (W3C and its older ones) as Bikube writes the key. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  arrow_up: 'ArrowUp',
  arrow_down: 'ArrowDown',
  arrow_left: 'ArrowLeft',
  arrow_right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  page_up: 'PageUp',
  page_down: 'PageDown',
  equal: '=',
  minus: '-',
  plus: '+',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  apostrophe: "'",
  quote: "'",
  backquote: '`',
  grave_accent: '`',
  bracket_left: '[',
  left_bracket: '[',
  bracket_right: ']',
  right_bracket: ']',
  backslash: '\\'
}

const MODIFIER_NAMES: Readonly<Record<string, 'ctrl' | 'alt' | 'shift' | 'cmd'>> = {
  shift: 'shift',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  super: 'cmd',
  cmd: 'cmd',
  command: 'cmd'
}

/** A Ghostty key as Bikube writes it, or null for one Bikube can't name. */
function ghosttyKey(name: string): string | null {
  const key = name.startsWith('physical:') ? name.slice('physical:'.length) : name
  if ([...key].length === 1) return /[\s\p{C}]/u.test(key) ? null : key.toUpperCase()
  const lower = key.toLowerCase()
  if (Object.hasOwn(KEY_NAMES, lower)) return KEY_NAMES[lower]!
  const letter = /^key_([a-z])$/.exec(lower)
  if (letter) return letter[1]!.toUpperCase()
  const digit = /^(?:digit_)?([0-9])$/.exec(lower)
  if (digit) return digit[1]!
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower)
  if (fn) return `F${fn[1]}`
  return null
}

/**
 * A Ghostty trigger (`super+shift+.`) as Bikube's shortcut text (`Shift+Cmd+>`, punctuation
 * shifted as a US layout types it, as the recorder sees it), or null when it isn't one: a sequence
 * (`a>b`), a global bind, a key Bikube can't name, or no Cmd, Ctrl or Alt.
 */
export function ghosttyTrigger(trigger: string): string | null {
  let rest = trigger
  for (;;) {
    const prefix = /^(all|unconsumed|performable|global):/.exec(rest)
    if (!prefix) break
    if (prefix[1] === 'global') return null
    rest = rest.slice(prefix[0].length)
  }
  if (/.>./.test(rest)) return null
  const keyAt = rest.endsWith('++') ? rest.length - 1 : rest.lastIndexOf('+') + 1
  const key = ghosttyKey(rest.slice(keyAt))
  if (key === null || rest.slice(keyAt) === '') return null
  const mods = { ctrl: false, alt: false, shift: false, cmd: false }
  const head = rest.slice(0, Math.max(0, keyAt - 1))
  for (const name of head === '' ? [] : head.split('+')) {
    const mod = MODIFIER_NAMES[name.toLowerCase()]
    if (mod === undefined) return null
    mods[mod] = true
  }
  if (!mods.ctrl && !mods.alt && !mods.cmd) return null
  const shifted = mods.shift && Object.hasOwn(SHIFTED, key) ? SHIFTED[key]! : key
  return formatShortcut({ ...mods, key: shifted })
}

/** The Bikube action of a Ghostty action, e.g. `resize_split:right,10`; null when none. */
function bikubeAction(action: string): ShortcutAction | null {
  const trimmed = action.trim()
  const withoutAmount = trimmed.replace(/^(resize_split:[a-z]+),.*$/, '$1')
  return GHOSTTY_ACTIONS[withoutAmount] ?? null
}

/**
 * Splits `trigger=action` at the first `=` after a trigger Ghostty could mean: `super+==x` binds
 * `=`. Null when there is no action.
 */
function splitBind(value: string): { trigger: string; action: string } | null {
  for (let at = value.indexOf('='); at >= 0; at = value.indexOf('=', at + 1)) {
    const trigger = value.slice(0, at).trim()
    const action = value.slice(at + 1).trim()
    if (trigger === '' || trigger.endsWith('+')) continue
    if (action === '') return null
    return { trigger, action }
  }
  return null
}

/**
 * Each Bikube action's shortcut from Ghostty's defaults and then the user's `keybinds`, as
 * Ghostty applies them: a trigger bound again replaces its bind, `unbind` removes it, `clear`
 * drops everything before it (defaults too), and an action bound twice keeps its last bind.
 */
export function ghosttyBinds(
  keybinds: readonly string[],
  platform: string
): Partial<Record<ShortcutAction, string>> {
  const binds = new Map<string, ShortcutAction | null>()
  const defaults = GHOSTTY_DEFAULTS[platform === 'darwin' ? 'darwin' : 'other']
  for (const value of [...defaults, ...keybinds]) {
    if (value.trim() === 'clear') {
      binds.clear()
      continue
    }
    const bind = splitBind(value)
    if (bind === null) continue
    const shortcut = ghosttyTrigger(bind.trigger)
    if (shortcut === null) continue
    // A trigger bound anew moves to the end, so the last bind of an action wins.
    binds.delete(shortcut)
    binds.set(shortcut, bind.action === 'unbind' ? null : bikubeAction(bind.action))
  }
  const result: Partial<Record<ShortcutAction, string>> = {}
  for (const [shortcut, action] of binds) if (action !== null) result[action] = shortcut
  return result
}

export interface GhosttyKeymap {
  keymap: Keymap
  /** The actions whose shortcut is Ghostty's. */
  fromGhostty: ShortcutAction[]
  /** Ghostty shortcuts not used, e.g. `Cmd+Q (Next pane): Quit`, for Settings to show. */
  skipped: string[]
}

/**
 * `keymap` (Bikube's own, the user's changes included) with Ghostty's shortcut for each action it
 * binds, except where that shortcut is fixed (D8), the global shortcut (#51 D5, registered system
 * wide, so the page would never see it) or another action not set by Ghostty has it: that one is
 * skipped and the action keeps its own.
 */
export function withGhosttyShortcuts(
  keymap: Keymap,
  binds: Partial<Record<ShortcutAction, string>>,
  platform: string,
  globalShortcut?: string
): GhosttyKeymap {
  const fixed = new Map(fixedShortcuts(platform))
  if (globalShortcut !== undefined) fixed.set(globalShortcut, GLOBAL_SHORTCUT_LABEL)
  const result = { ...keymap }
  const skipped: string[] = []
  const set = SHORTCUT_ACTIONS.filter((action) => {
    const shortcut = binds[action]
    if (shortcut === undefined || shortcut === keymap[action]) return shortcut !== undefined
    const owner = fixed.get(shortcut)
    if (owner !== undefined) {
      skipped.push(`${shortcut} (${SHORTCUT_LABELS[action]}): ${owner}`)
      return false
    }
    result[action] = shortcut
    return true
  })
  // A Ghostty shortcut another action holds goes back to Bikube's; that may free or take another
  // action's, so repeat until no two share one. Bikube's own never share, so this ends.
  const fromGhostty = new Set(set)
  for (;;) {
    const action = [...fromGhostty].find((a) =>
      SHORTCUT_ACTIONS.some((o) => o !== a && !fromGhostty.has(o) && result[o] === result[a])
    )
    if (action === undefined) break
    const other = SHORTCUT_ACTIONS.find(
      (o) => o !== action && !fromGhostty.has(o) && result[o] === result[action]
    )!
    skipped.push(`${result[action]} (${SHORTCUT_LABELS[action]}): ${SHORTCUT_LABELS[other]}`)
    result[action] = keymap[action]
    fromGhostty.delete(action)
  }
  return {
    keymap: result,
    fromGhostty: SHORTCUT_ACTIONS.filter((action) => fromGhostty.has(action)),
    skipped
  }
}
