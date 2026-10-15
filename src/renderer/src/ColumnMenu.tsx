import { ArrowLeft, ArrowRight, Pencil, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { MENU_ICON } from './icons'
import MenuButton from './MenuButton'

interface ColumnMenuProps {
  columnName: string
  canMoveLeft: boolean
  canMoveRight: boolean
  canDelete: boolean
  /** Why Delete is disabled, shown under it (#4 D14); none for the last column. */
  deleteHint?: string | null
  onRename: () => void
  onMove: (direction: 'left' | 'right') => void
  onDelete: () => void
}

/** The ⋯ menu on a column header. Esc closes and returns focus; click outside closes. */
function ColumnMenu(props: ColumnMenuProps): React.JSX.Element {
  const hintId = useId()
  const hint = !props.canDelete && props.deleteHint ? props.deleteHint : null
  return (
    <MenuButton
      label={`Column menu for ${props.columnName}`}
      menuLabel={`${props.columnName} actions`}
      testId="column-menu"
    >
      {(run) => (
        <>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-testid="menu-rename"
            onClick={run(props.onRename)}
          >
            <Pencil {...MENU_ICON} />
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
            <ArrowLeft {...MENU_ICON} />
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
            <ArrowRight {...MENU_ICON} />
            Move right
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item-danger"
            data-testid="menu-delete"
            disabled={!props.canDelete}
            title={hint ?? undefined}
            aria-describedby={hint ? hintId : undefined}
            onClick={run(props.onDelete)}
          >
            <Trash2 {...MENU_ICON} />
            Delete
          </button>
          {hint && (
            <p className="menu-hint" id={hintId} data-testid="menu-delete-hint">
              {hint}
            </p>
          )}
        </>
      )}
    </MenuButton>
  )
}

export default ColumnMenu
