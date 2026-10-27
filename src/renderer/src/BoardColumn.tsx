import { useEffect, useState } from 'react'
import { columnDeleteHint } from '../../core/card-deletes'
import { columnOrder } from '../../core/card-grid'
import {
  dropIndex,
  hoverHalf,
  nearestCardHover,
  sortedDropIndex,
  type CardHover
} from '../../core/card-drops'
import { shownCards, showAllLabel } from '../../core/column-limit'
import {
  cardsInColumn,
  workspaceSort,
  type Column,
  type Workspace
} from '../../core/workspace-store'
import { movedCard } from './card-actions'
import CardItem from './CardItem'
import { draggedCard, endCardDrag } from './card-drag'
import ColumnMenu from './ColumnMenu'
import InlineInput from './InlineInput'
import NewCard from './NewCard'
import { useSettings } from './settings'
import { workspaceStore } from './store'

/** The columns unfolded with Show all, by id, for the run of the app (kept across Back). */
const expandedColumns = new Set<string>()

interface BoardColumnProps {
  workspace: Workspace
  column: Column
  index: number
  total: number
  onOpenCard: (cardId: string) => void
  /** A request to open this column's New card dialog (#40 D9), see `NewCard`. */
  openNewCard?: number
}

function BoardColumn({
  workspace,
  column,
  index,
  total,
  onOpenCard,
  openNewCard
}: BoardColumnProps): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  // Where a card dragged over this column would land (#6 D5, D6), or null.
  const [dropAt, setDropAt] = useState<{ cardId: string; index: number } | null>(null)
  const workspaceId = workspace.id
  // Under the Recently opened first sort, shown newest first; the stored order stays (#69 D12).
  const sort = workspaceSort(workspace)
  const cards = columnOrder(cardsInColumn(workspace, column.id), sort)
  const deletable = columnDeleteHint(workspace, column.id)
  // Card display limit: a folded column shows its first this many.
  const limit = useSettings().columnCardLimit
  const [expanded, setExpandedState] = useState(() => expandedColumns.has(column.id))
  const setExpanded = (next: boolean): void => {
    if (next) expandedColumns.add(column.id)
    else expandedColumns.delete(column.id)
    setExpandedState(next)
  }
  // A card moved by keyboard or menu past the folded part unfolds the column, so it keeps focus.
  const moved = movedCard()
  if (
    !expanded &&
    moved &&
    cards.findIndex((c) => c.id === moved) >= shownCards(cards, false, limit).length
  ) {
    setExpanded(true)
  }
  const shown = shownCards(cards, expanded, limit)
  const toggleLabel = showAllLabel(cards.length, expanded, limit)

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
    // A sorted column has no place to drop into: a card from another column joins it (#69 D12).
    if (sort === 'recent') {
      const index = sortedDropIndex(
        cards.map((c) => c.id),
        drag.cardId
      )
      return index === null ? null : { cardId: drag.cardId, index }
    }
    // The cards shown are the column's first, so a place among them is its place in the column.
    const ids = shown.map((c) => c.id)
    const el = (e.target as Element).closest<HTMLElement>('[data-card-id]')
    const hovered = el?.dataset.cardId
    let over: CardHover | 'bottom' = 'bottom'
    const list = (e.target as Element).closest<HTMLElement>('.card-list')
    if (el && hovered && ids.includes(hovered)) {
      const box = el.getBoundingClientRect()
      over = { cardId: hovered, half: hoverHalf(e.clientY, box.top, box.height) }
    } else if (list) {
      // In a gap between cards or just above the first: the nearest card decides (D6).
      const boxes = Array.from(list.querySelectorAll<HTMLElement>('[data-card-id]')).map((c) => {
        const box = c.getBoundingClientRect()
        return { cardId: c.dataset.cardId ?? '', top: box.top, height: box.height }
      })
      over = nearestCardHover(boxes, e.clientY)
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
    // Dropped after the last card shown, it would be folded away: the column unfolds.
    if (sort === 'manual' && target.index >= limit) setExpanded(true)
    // Sorted, its place among the column's cards decides.
    const dropped = workspace.cards.find((c) => c.id === target.cardId)
    if (sort === 'recent' && dropped) {
      const after = columnOrder([...cards, dropped], sort)
      if (after.indexOf(dropped) >= limit) setExpanded(true)
    }
    workspaceStore.moveCard(workspaceId, target.cardId, column.id, target.index)
  }

  // The line goes above the card at the drop position, counted without the dragged card,
  // or below the column's last card. A sorted column shows none: it is outlined instead.
  const lineAt = sort === 'manual' ? dropAt : null
  const others = lineAt ? shown.filter((c) => c.id !== lineAt.cardId) : shown
  const lineBefore = lineAt && others[lineAt.index]?.id
  const lineAfter = lineAt && !lineBefore ? shown[shown.length - 1]?.id : undefined

  return (
    <li
      className="board-column"
      data-testid="column"
      data-drop={dropAt && sort === 'recent' && cards.length > 0 ? 'into' : undefined}
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
              sort={sort}
              onSort={(next) => workspaceStore.updateWorkspace(workspaceId, { sort: next })}
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
          {shown.map((card) => (
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
      {toggleLabel && (
        <button
          type="button"
          className="column-show-all"
          data-testid="column-show-all"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {toggleLabel}
        </button>
      )}
      <NewCard
        workspaceId={workspaceId}
        columnId={column.id}
        columnName={column.name}
        defaultStartup={workspace.defaultStartup}
        onCreated={(cardId) => {
          // A new card goes to the bottom: past the fold, the column unfolds to show it on Back.
          if (cards.length >= limit) setExpanded(true)
          onOpenCard(cardId)
        }}
        openRequest={openNewCard}
      />
    </li>
  )
}

export default BoardColumn
