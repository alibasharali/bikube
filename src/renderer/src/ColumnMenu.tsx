import { ArrowLeft, ArrowRight, Check, Pencil, Trash2 } from 'lucide-react'
import { useId } from 'react'
import type { WorkspaceSort } from '../../core/workspace-store'
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
  /** The board's sort (#69 D12), for the whole board: every column's menu shows and sets it. */
  sort: WorkspaceSort
  onSort: (sort: WorkspaceSort) => void
}

const SORT_LABELS: Record<WorkspaceSort, string> = {
  manual: 'Sort: Manual order',
  recent: 'Sort: Recently opened first'
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
          {/* One sort for the whole board, the same in every column's menu (#69 D12). */}
          <div className="menu-group" role="group" aria-label="Sort">
            {(['manual', 'recent'] as const).map((sort) => (
              <button
                key={sort}
                type="button"
                role="menuitemradio"
                aria-checked={props.sort === sort}
                className="menu-item menu-item-checkable"
                data-testid={`menu-sort-${sort}`}
                onClick={run(() => props.onSort(sort))}
              >
                {props.sort === sort ? (
                  <Check {...MENU_ICON} />
                ) : (
                  <span className="branch-menu-spacer" aria-hidden="true" />
                )}
                {SORT_LABELS[sort]}
              </button>
            ))}
          </div>
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
