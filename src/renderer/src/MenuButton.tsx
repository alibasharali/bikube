import { useEffect, useRef, useState } from 'react'

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
  /** The menu items; `run(action)` closes the menu and then runs the action. */
  children: (run: (action: () => void) => () => void) => React.ReactNode
}

/** A ⋯ button with a menu. Esc closes and returns focus; click outside or Tab closes. */
function MenuButton({
  label,
  menuLabel,
  testId,
  className,
  fixed,
  children
}: MenuButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<React.CSSProperties | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const run = (action: () => void) => (): void => {
    setOpen(false)
    action()
  }

  const toggle = (): void => {
    if (!open && fixed && button.current) {
      const rect = button.current.getBoundingClientRect()
      setPosition({
        position: 'fixed',
        top: rect.bottom + 4,
        right: Math.max(0, window.innerWidth - rect.right)
      })
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
        root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
      )
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
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
        className="icon-btn"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
      >
        ⋯
      </button>
      {open && (
        <div
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
