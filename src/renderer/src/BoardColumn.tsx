import { useEffect, useState } from 'react'
import { columnDeleteHint } from '../../core/card-deletes'
import { dropIndex, hoverHalf, type CardHover } from '../../core/card-drops'
import { cardsInColumn, type Column, type Workspace } from '../../core/workspace-store'
import CardItem from './CardItem'
import { draggedCard, endCardDrag } from './card-drag'
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
  // Where a card dragged over this column would land (#6 D5, D6), or null.
  const [dropAt, setDropAt] = useState<{ cardId: string; index: number } | null>(null)
  const workspaceId = workspace.id
  const cards = cardsInColumn(workspace, column.id)
  const deletable = columnDeleteHint(workspace, column.id)

  // A drag that ends anywhere (dropped, cancelled with Esc or outside) clears the line.
  useEffect(() => {
    const clear = (): void => setDropAt(null)
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  }, [])

  /** The drop position for a card dragged over this column, or null if it isn't ours. */
  const dropTarget = (e: React.DragEvent): { cardId: string; index: number } | null => {
    const drag = draggedCard(workspaceId, e.dataTransfer)
    if (!drag) return null
    const ids = cards.map((c) => c.id)
    const el = (e.target as Element).closest<HTMLElement>('[data-card-id]')
    const hovered = el?.dataset.cardId
    let over: CardHover | 'bottom' = 'bottom'
    if (el && hovered && ids.includes(hovered)) {
      const box = el.getBoundingClientRect()
      over = { cardId: hovered, half: hoverHalf(e.clientY, box.top, box.height) }
    }
    return { cardId: drag.cardId, index: dropIndex(ids, drag.cardId, over) }
  }

  const onDragOver = (e: React.DragEvent): void => {
    const target = dropTarget(e)
    if (!target) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (target.cardId !== dropAt?.cardId || target.index !== dropAt.index) setDropAt(target)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
  }

  const onDrop = (e: React.DragEvent): void => {
    const target = dropTarget(e)
    if (!target) return
    e.preventDefault()
    setDropAt(null)
    endCardDrag()
    workspaceStore.moveCard(workspaceId, target.cardId, column.id, target.index)
  }

  // The line goes above the card at the drop position, counted without the dragged card,
  // or below the column's last card.
  const others = dropAt ? cards.filter((c) => c.id !== dropAt.cardId) : cards
  const lineBefore = dropAt && others[dropAt.index]?.id
  const lineAfter = dropAt && !lineBefore ? cards[cards.length - 1]?.id : undefined

  return (
    <li
      className="board-column"
      data-testid="column"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
        <p className="column-empty" data-drop={dropAt ? 'into' : undefined}>
          No cards yet
        </p>
      ) : (
        <ul className="card-list">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              workspaceId={workspaceId}
              card={card}
              columns={workspace.columns}
              drop={card.id === lineBefore ? 'before' : card.id === lineAfter ? 'after' : undefined}
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
