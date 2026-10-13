import { useState } from 'react'
import { columnDeleteHint } from '../../core/card-deletes'
import { cardsInColumn, type Column, type Workspace } from '../../core/workspace-store'
import CardItem from './CardItem'
import ColumnMenu from './ColumnMenu'
import InlineInput from './InlineInput'
import NewCard from './NewCard'
import { workspaceStore } from './store'

interface BoardColumnProps {
  workspace: Workspace
  column: Column
  index: number
  total: number
  onOpenCard: (cardId: string) => void
}

function BoardColumn({
  workspace,
  column,
  index,
  total,
  onOpenCard
}: BoardColumnProps): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const workspaceId = workspace.id
  const cards = cardsInColumn(workspace, column.id)
  const deletable = columnDeleteHint(workspace, column.id)
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
            <span
              className="count"
              data-testid="column-count"
              aria-label={cards.length === 1 ? '1 card' : `${cards.length} cards`}
            >
              {cards.length}
            </span>
            <ColumnMenu
              columnName={column.name}
              canMoveLeft={index > 0}
              canMoveRight={index < total - 1}
              canDelete={deletable.canDelete}
              deleteHint={deletable.hint}
              onRename={() => setRenaming(true)}
              onMove={(d) => workspaceStore.moveColumn(workspaceId, column.id, d)}
              onDelete={() => workspaceStore.deleteColumn(workspaceId, column.id)}
            />
          </>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="column-empty">No cards yet</p>
      ) : (
        <ul className="card-list">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              workspaceId={workspaceId}
              card={card}
              onOpen={() => onOpenCard(card.id)}
            />
          ))}
        </ul>
      )}
      <NewCard
        workspaceId={workspaceId}
        columnId={column.id}
        defaultStartup={workspace.defaultStartup}
        onCreated={onOpenCard}
      />
    </li>
  )
}

export default BoardColumn
