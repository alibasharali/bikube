import { useEffect, useRef, useState } from 'react'

interface ColumnMenuProps {
  columnName: string
  canMoveLeft: boolean
  canMoveRight: boolean
  canDelete: boolean
  onRename: () => void
  onMove: (direction: 'left' | 'right') => void
  onDelete: () => void
}

/** The ⋯ menu on a column header. Esc closes and returns focus; click outside closes. */
function ColumnMenu(props: ColumnMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
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
    <div className="column-menu-wrap" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        data-testid="column-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Column menu for ${props.columnName}`}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={`${props.columnName} actions`}>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-testid="menu-rename"
            onClick={run(props.onRename)}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-testid="menu-move-left"
            disabled={!props.canMoveLeft}
            onClick={run(() => props.onMove('left'))}
          >
            Move left
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-testid="menu-move-right"
            disabled={!props.canMoveRight}
            onClick={run(() => props.onMove('right'))}
          >
            Move right
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item-danger"
            data-testid="menu-delete"
            disabled={!props.canDelete}
            onClick={run(props.onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

export default ColumnMenu
