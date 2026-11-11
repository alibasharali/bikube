import { Ellipsis } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ICON } from './icons'

interface MenuButtonProps {
  /** Accessible name of the ⋯ button. */
  label: string
  /** Accessible name of the open menu. */
  menuLabel: string
  testId: string
  className?: string
  /**
   * Places the menu with fixed positioning under the button, so a scrolling list (the cards in
   * a column) does not clip it.
   */
  fixed?: boolean
  /**
   * With `fixed`, which edge of the button the menu lines up with: `end` (the default) grows it
   * leftwards from the button's right edge, `start` rightwards from its left edge. Either way it
   * is kept inside the window.
   */
  align?: 'start' | 'end'
  /** The menu items; `run(action)` closes the menu and then runs the action. */
  children: (run: (action: () => void) => () => void) => React.ReactNode
  /** The button's content and class: ⋯ in an icon button by default. */
  icon?: React.ReactNode
  buttonClassName?: string
  /** Makes the button a toggle too (`aria-pressed`), as a filter chip with a menu (#71 D4). */
  pressed?: boolean
}

/** A ⋯ button with a menu. Esc closes and returns focus; click outside or Tab closes. */
function MenuButton({
  label,
  menuLabel,
  testId,
  className,
  fixed,
  align = 'end',
  children,
  icon,
  buttonClassName = 'icon-btn',
  pressed
}: MenuButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<React.CSSProperties | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    // The document the menu is in: the main window's, or a card window's (#53 D5).
    const doc = root.current?.ownerDocument ?? document
    doc.addEventListener('mousedown', onDown)
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    return () => doc.removeEventListener('mousedown', onDown)
  }, [open])

  // A fixed menu wider than the room on its side moves back inside the window.
  useLayoutEffect(() => {
    if (!open || !fixed || !menu.current) return
    const el = menu.current
    const width = (el.ownerDocument.defaultView ?? window).innerWidth
    const rect = el.getBoundingClientRect()
    if (rect.left >= 0 && rect.right <= width) return
    const left = Math.max(0, Math.min(rect.left, width - rect.width - 4))
    if (Math.abs(left - rect.left) < 0.5) return
    setPosition((p) => ({ position: 'fixed', top: p?.top, left, right: 'auto' }))
  }, [open, fixed, position])

  const run = (action: () => void) => (): void => {
    setOpen(false)
    action()
  }

  const toggle = (): void => {
    if (!open && fixed && button.current) {
      const rect = button.current.getBoundingClientRect()
      const width = (button.current.ownerDocument.defaultView ?? window).innerWidth
      setPosition(
        align === 'start'
          ? { position: 'fixed', top: rect.bottom + 4, left: Math.max(0, rect.left), right: 'auto' }
          : { position: 'fixed', top: rect.bottom + 4, right: Math.max(0, width - rect.right) }
      )
    }
    setOpen((o) => !o)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = Array.from(
        root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []
      )
      if (items.length === 0) return
      const at = items.indexOf(root.current?.ownerDocument.activeElement as HTMLElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length].focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div
      className={className ? `menu-wrap ${className}` : 'menu-wrap'}
      ref={root}
      onKeyDown={onKeyDown}
    >
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={pressed}
        aria-label={label}
        onClick={toggle}
      >
        {icon ?? <Ellipsis {...ICON} />}
      </button>
      {open && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          aria-label={menuLabel}
          style={fixed ? position : undefined}
        >
          {children(run)}
        </div>
      )}
    </div>
  )
}

export default MenuButton
