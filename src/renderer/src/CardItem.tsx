import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_PRESETS } from '../../core/agent-presets'
import { cardMoveKey } from '../../core/card-moves'
import { cardDeleteConfirmation } from '../../core/card-deletes'
import type { StartupCommand } from '../../core/startup-command'
import type { Card, Column } from '../../core/workspace-store'
import CardLines from './CardLines'
import CloseCardDialog from './CloseCardDialog'
import ConfirmDialog from './ConfirmDialog'
import InlineInput from './InlineInput'
import MenuButton from './MenuButton'
import StartupDialog from './StartupDialog'
import { moveCardByKey, moveCardToColumn, removeCard, takeFocusAfterMove } from './card-actions'
import { CARD_DRAG_TYPE, endCardDrag, startCardDrag } from './card-drag'
import { cardTerminals, useCardRunState, useCardStatus } from './card-terminals'
import { workspaceStore } from './store'

/**
 * The card's startup command on the board (#5 D12, #21 D5): `Claude` for Claude Code, a preset's
 * tag with its select label as tooltip, `Custom` with the command as its tooltip, nothing for
 * Shell. It follows the setting, not what is running.
 */
function StartupTag({ startup }: { startup: StartupCommand }): React.JSX.Element | null {
  if (startup.kind === 'shell') return null
  const [tag, title] =
    startup.kind === 'custom'
      ? ['Custom', startup.command]
      : startup.kind === 'claude'
        ? ['Claude', 'Claude Code']
        : [AGENT_PRESETS[startup.kind].tag, AGENT_PRESETS[startup.kind].label]
  return (
    <span className="card-tag" data-testid="card-tag" title={title}>
      {tag}
    </span>
  )
}

/** How long a click on the title waits for a second click (double-click renames, D12). */
const DOUBLE_CLICK_MS = 250

interface CardItemProps {
  workspaceId: string
  card: Card
  /** The board's columns in board order, for the menu's `Move to` group (#6 D8). */
  columns: Column[]
  /** Where the drop line shows on this card while another card is dragged (#6 D5, D6). */
  drop?: 'before' | 'after'
  onOpen: () => void
}

/**
 * A card on the board (#4 D5, D7, D9, D12, D13): its title and status; click or Enter opens
 * it. Its ⋯ menu renames it inline (as does double-clicking the title), changes its startup
 * command (#5 D11), moves it to the bottom of another column (#6 D8), closes it while it runs
 * (#7 D3, D4), or deletes it, asking first while its process runs. Alt+arrows move it (#6 D7); its body drags it to another place
 * on the board, dimmed meanwhile (#6 D5). A running card's stop button opens the same Close
 * confirmation (#31 D10).
 */
function CardItem({ workspaceId, card, columns, drop, onOpen }: CardItemProps): React.JSX.Element {
  const status = useCardStatus(card.id)
  const running = useCardRunState(card.id).kind === 'running'
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [editingStartup, setEditingStartup] = useState(false)
  const [closing, setClosing] = useState(false)
  // A card that stops by itself while its Close dialog is open has nothing left to close.
  if (closing && !running) setClosing(false)
  const [dragging, setDragging] = useState(false)
  const dragActive = useRef(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const moveLabelId = useId()
  const moveTargets = columns.filter((c) => c.id !== card.columnId)
  const pendingOpen = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPendingOpen = (): void => {
    if (pendingOpen.current) clearTimeout(pendingOpen.current)
    pendingOpen.current = null
  }
  useEffect(() => cancelPendingOpen, [])
  // A keyboard or menu move may remount or reorder this card; it keeps focus (#6 D7, D8).
  useLayoutEffect(() => {
    if (takeFocusAfterMove(card.id)) openRef.current?.focus()
  })

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const direction = cardMoveKey(e)
    if (!direction) return
    e.preventDefault()
    moveCardByKey(workspaceId, card.id, direction)
  }

  const onClick = (e: React.MouseEvent): void => {
    cancelPendingOpen()
    // The second click of a double-click: the title's dblclick handler renames.
    if (e.detail > 1) return
    // A click on the title may be the start of a double-click; wait for it before opening.
    if (e.detail === 1 && titleRef.current?.contains(e.target as Node)) {
      pendingOpen.current = setTimeout(() => {
        pendingOpen.current = null
        onOpen()
      }, DOUBLE_CLICK_MS)
      return
    }
    onOpen()
  }

  // Dragging never opens the card, even after a click on the title just before (#6 D5).
  const onDragStart = (e: React.DragEvent): void => {
    cancelPendingOpen()
    e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
    e.dataTransfer.effectAllowed = 'move'
    startCardDrag({ workspaceId, cardId: card.id })
    dragActive.current = true
    // Dim after the browser has taken the drag image from the undimmed card.
    setTimeout(() => setDragging(dragActive.current), 0)
  }

  const onDragEnd = (): void => {
    dragActive.current = false
    endCardDrag()
    setDragging(false)
  }

  const startRename = (): void => {
    cancelPendingOpen()
    setRenaming(true)
  }

  const onDelete = (): void => {
    const message = cardDeleteConfirmation(card.title, cardTerminals().runState(card.id))
    if (message) setConfirm(message)
    else removeCard(workspaceId, card.id)
  }

  return (
    <li
      className={dragging ? 'card card-dragging' : 'card'}
      data-testid="card"
      data-card-id={card.id}
      data-drop={drop}
    >
      {renaming ? (
        <div className="card-body card-renaming">
          <InlineInput
            className="card-rename"
            initial={card.title}
            label={`Rename card ${card.title}`}
            inputTestId="card-rename-input"
            errorTestId="card-rename-error"
            onCommit={(title) => workspaceStore.renameCard(workspaceId, card.id, title)}
            onDone={() => setRenaming(false)}
          />
          <CardLines status={status} />
        </div>
      ) : (
        <button
          ref={openRef}
          type="button"
          className="card-body card-open"
          data-testid="card-open"
          aria-label={`Open ${card.title}`}
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onClick}
          onKeyDown={onKeyDown}
        >
          <span className="card-title-row">
            <span
              ref={titleRef}
              className="card-title"
              data-testid="card-title"
              title={card.title}
              onDoubleClick={startRename}
            >
              {card.title}
            </span>
            <StartupTag startup={card.startup} />
          </span>
          <CardLines status={status} />
        </button>
      )}
      {running && (
        <button
          type="button"
          className="card-stop"
          data-testid="card-stop"
          aria-label="Close"
          title="Close"
          onClick={(e) => {
            // Opens the Close confirmation, never the card (#31 D10).
            e.stopPropagation()
            cancelPendingOpen()
            setClosing(true)
          }}
        >
          <span aria-hidden="true">■</span>
        </button>
      )}
      <MenuButton
        className="card-menu-wrap"
        label={`Card menu for ${card.title}`}
        menuLabel={`${card.title} actions`}
        testId="card-menu"
        fixed
      >
        {(run) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="card-menu-rename"
              onClick={run(startRename)}
            >
              Rename
            </button>
            {moveTargets.length > 0 && (
              <div className="menu-group" role="group" aria-labelledby={moveLabelId}>
                <p className="menu-label" id={moveLabelId}>
                  Move to
                </p>
                {moveTargets.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    data-testid="card-menu-move-to"
                    onClick={run(() => moveCardToColumn(workspaceId, card.id, c.id))}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="card-menu-startup"
              onClick={run(() => {
                cancelPendingOpen()
                setEditingStartup(true)
              })}
            >
              Startup command…
            </button>
            {running && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="card-menu-close"
                onClick={run(() => {
                  cancelPendingOpen()
                  setClosing(true)
                })}
              >
                Close
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item-danger"
              data-testid="card-menu-delete"
              onClick={run(onDelete)}
            >
              Delete
            </button>
          </>
        )}
      </MenuButton>
      {editingStartup && (
        <StartupDialog
          workspaceId={workspaceId}
          card={card}
          onClose={() => setEditingStartup(false)}
        />
      )}
      {closing && (
        <CloseCardDialog cardId={card.id} title={card.title} onDone={() => setClosing(false)} />
      )}
      {confirm && (
        <ConfirmDialog
          title="Delete card"
          message={confirm}
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            removeCard(workspaceId, card.id)
          }}
        />
      )}
    </li>
  )
}

export default CardItem
