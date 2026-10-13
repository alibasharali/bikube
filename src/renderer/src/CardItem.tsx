import { useEffect, useRef, useState } from 'react'
import { cardDeleteConfirmation } from '../../core/card-deletes'
import type { StartupCommand } from '../../core/startup-command'
import type { Card } from '../../core/workspace-store'
import CardStatusLine from './CardStatusLine'
import ConfirmDialog from './ConfirmDialog'
import InlineInput from './InlineInput'
import MenuButton from './MenuButton'
import StartupDialog from './StartupDialog'
import { removeCard } from './card-actions'
import { cardTerminals, useCardStatus } from './card-terminals'
import { workspaceStore } from './store'

/**
 * The card's startup command on the board (#5 D12): `Claude` for Claude Code, `Custom` with
 * the command as its tooltip, nothing for Shell. It follows the setting, not what is running.
 */
function StartupTag({ startup }: { startup: StartupCommand }): React.JSX.Element | null {
  if (startup.kind === 'shell') return null
  const custom = startup.kind === 'custom'
  return (
    <span
      className="card-tag"
      data-testid="card-tag"
      title={custom ? startup.command : 'Claude Code'}
    >
      {custom ? 'Custom' : 'Claude'}
    </span>
  )
}

/** How long a click on the title waits for a second click (double-click renames, D12). */
const DOUBLE_CLICK_MS = 250

interface CardItemProps {
  workspaceId: string
  card: Card
  onOpen: () => void
}

/**
 * A card on the board (#4 D5, D7, D9, D12, D13): its title and status; click or Enter opens
 * it. Its ⋯ menu renames it inline (as does double-clicking the title), changes its startup
 * command (#5 D11), or deletes it, asking first while its process runs.
 */
function CardItem({ workspaceId, card, onOpen }: CardItemProps): React.JSX.Element {
  const status = useCardStatus(card.id)
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [editingStartup, setEditingStartup] = useState(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const pendingOpen = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPendingOpen = (): void => {
    if (pendingOpen.current) clearTimeout(pendingOpen.current)
    pendingOpen.current = null
  }
  useEffect(() => cancelPendingOpen, [])

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
    <li className="card" data-testid="card" data-card-id={card.id}>
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
          <CardStatusLine status={status} />
        </div>
      ) : (
        <button
          type="button"
          className="card-body card-open"
          data-testid="card-open"
          aria-label={`Open ${card.title}`}
          onClick={onClick}
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
          <CardStatusLine status={status} />
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
