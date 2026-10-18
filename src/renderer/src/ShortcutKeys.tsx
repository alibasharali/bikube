// Shortcuts as key caps, shown the same in Settings and the command palette.

const MAC_KEYS: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Cmd: '⌘',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→'
}

/**
 * A shortcut as key caps: on macOS its symbols (`⇧⌘B`), elsewhere its keys joined with `+` (so the
 * text stays `Ctrl+Shift+B`).
 */
function ShortcutKeys({
  shortcut,
  platform
}: {
  shortcut: string
  platform: string
}): React.JSX.Element {
  const keys = shortcut.split(/\+(?=.)/)
  const mac = platform === 'darwin'
  return (
    <span className="keys">
      {keys.map((key, i) => (
        <span key={i} className="keys-part">
          {!mac && i > 0 && <span className="keys-plus">+</span>}
          <kbd>{mac ? (MAC_KEYS[key] ?? key) : key}</kbd>
        </span>
      ))}
    </span>
  )
}

export default ShortcutKeys
