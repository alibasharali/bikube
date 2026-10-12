import { useState } from 'react'
import type { Column } from '../../core/workspace-store'
import ColumnMenu from './ColumnMenu'
import InlineInput from './InlineInput'
import { workspaceStore } from './store'

interface BoardColumnProps {
  workspaceId: string
  column: Column
  index: number
  total: number
}

function BoardColumn({ workspaceId, column, index, total }: BoardColumnProps): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  return (
    <li className="board-column" data-testid="column">
      <div className="column-header">
        {renaming ? (
          <InlineInput
            className="column-rename"
            initial={column.name}
            label={`Rename column ${column.name}`}
            inputTestId="column-rename-input"
            errorTestId="column-error"
            onCommit={(name) => workspaceStore.renameColumn(workspaceId, column.id, name)}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <>
            <h2
              className="column-name"
              data-testid="column-name"
              title="Double-click to rename"
              onDoubleClick={() => setRenaming(true)}
            >
              {column.name}
            </h2>
            <span className="count" data-testid="column-count" aria-label="0 cards">
              0
            </span>
            <ColumnMenu
              columnName={column.name}
              canMoveLeft={index > 0}
              canMoveRight={index < total - 1}
              canDelete={total > 1}
              onRename={() => setRenaming(true)}
              onMove={(d) => workspaceStore.moveColumn(workspaceId, column.id, d)}
              onDelete={() => workspaceStore.deleteColumn(workspaceId, column.id)}
            />
          </>
        )}
      </div>
      <p className="column-empty">No cards yet</p>
    </li>
  )
}

export default BoardColumn
