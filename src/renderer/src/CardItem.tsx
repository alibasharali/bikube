import { ToolIcon } from './AgentLogo'
import {
  AppWindow,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Pencil,
  RotateCw,
  SkipForward,
  Square,
  SquareTerminal,
  Trash2,
  TreePine,
  X
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_PRESETS } from '../../core/agent-presets'
import { cardMoveKey } from '../../core/card-moves'
import { cardDeleteConfirmation } from '../../core/card-deletes'
import type { StartupCommand } from '../../core/startup-command'
import type { Card, CardWorktree, Column } from '../../core/workspace-store'
import { refreshBranch, useBranch } from './branches'
import { dismissCardGitAction, runCardGitAction, useCardGitAction } from './card-git'
import { refreshPullRequest, usePullRequest } from './pull-requests'
import CardLines from './CardLines'
import CloseCardDialog from './CloseCardDialog'
import DevServerChips from './DevServerChips'
import ConfirmDialog from './ConfirmDialog'
import InlineInput from './InlineInput'
import MergeCardDialog, { type MergeChoice } from './MergeCardDialog'
import { MENU_ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'
import StartupDialog from './StartupDialog'
import {
  moveCardByKey,
  moveCardToColumn,
  removeCard,
  removeWorktreeCard,
  retrySetup,
  skipSetup,
  takeFocusAfterMove
} from './card-actions'
import DeleteWorktreeCardDialog from './DeleteWorktreeCardDialog'
import { CARD_DRAG_TYPE, endCardDrag, startCardDrag } from './card-drag'
import { cardTerminals, useCardRunState, useCardStatus } from './card-terminals'
import { openCardWindow, useInWindow } from './card-windows'
import { workspaceStore } from './store'
import { useCardUsage } from './usage'

/**
 * The card's startup command (#5 D12, #21 D5): the agent's logo for Claude Code and the presets, a
 * prompt for Custom, with its name (`Claude`, a preset's tag, `Custom`) for screen readers and its
 * select label (or the command) as tooltip; nothing for Shell. In the title bar it sits before the
 * name; on a board card (`watermark`) it is a large faint logo behind the card's content. It
 * follows the setting, not what is running, and takes its kind's colour (`--kind`).
 */
export function StartupTag({
  startup,
  watermark = false
}: {
  startup: StartupCommand
  watermark?: boolean
}): React.JSX.Element | null {
  if (startup.kind === 'shell') return null
  const [tag, title] =
    startup.kind === 'custom'
      ? ['Custom', startup.command]
      : startup.kind === 'claude'
        ? ['Claude', 'Claude Code']
        : [AGENT_PRESETS[startup.kind].tag, AGENT_PRESETS[startup.kind].label]
  return (
    <span
      className={watermark ? 'card-tag card-watermark' : 'card-tag'}
      data-testid="card-tag"
      data-kind={startup.kind}
      title={title}
    >
      <ToolIcon tool={startup.kind} size={watermark ? 96 : 14} />
      <span className="visually-hidden">{tag}</span>
    </span>
  )
}

/**
 * A branch: a tree for a card's own worktree (under its title, and in the title bar), the plain
 * branch icon for the workspace's folder.
 */
export function WorktreeBranch({
  branch,
  worktree = false
}: {
  branch: string
  worktree?: boolean
}): React.JSX.Element {
  const Icon = worktree ? TreePine : GitBranch
  return (
    <span
      className={worktree ? 'card-branch card-branch-worktree' : 'card-branch'}
      data-testid="card-branch"
      data-worktree={worktree || undefined}
      title={worktree ? `Own worktree on ${branch}` : `On ${branch}`}
    >
      <Icon {...SMALL_ICON} />
      <span className="card-branch-name">{branch}</span>
    </span>
  )
}

/**
 * A worktree card's action line (#38 D6), under its branch: the running action's busy label, then
 * its note, or git's message with a Dismiss button. Outside the card's open button, so Dismiss
 * is a button of its own.
 */
function CardGitActionLine({ cardId }: { cardId: string }): React.JSX.Element | null {
  const { busy, error, note } = useCardGitAction(cardId)
  const text = busy ?? error ?? note
  if (text === null) return null
  const state = busy !== null ? 'busy' : error !== null ? 'error' : 'note'
  return (
    <div
      className="card-action"
      data-testid="card-action"
      data-state={state}
      role={state === 'error' ? 'alert' : 'status'}
    >
      <span className="card-action-text">{text}</span>
      {state === 'error' && (
        <button
          type="button"
          className="card-action-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => dismissCardGitAction(cardId)}
        >
          <X {...SMALL_ICON} />
        </button>
      )}
    </div>
  )
}

/**
 * A worktree card's pull request chip (#38 D8): `#<n>` with its CI dot for an open PR, `#<n>
 * merged` or `#<n> closed`, nothing without a PR known. A button of its own, outside the card's
 * open button: a click opens the PR in the browser and never the card.
 */
function PullRequestChip({ worktree }: { worktree: CardWorktree }): React.JSX.Element | null {
  const pr = usePullRequest(worktree.path, useBranch(worktree.path))
  if (pr === null) return null
  const open = pr.state === 'open'
  const ci = open ? pr.ci : null
  const what = open ? (ci ?? 'no checks') : pr.state
  return (
    <button
      type="button"
      className="card-pr"
      data-testid="card-pr"
      data-state={pr.state}
      data-ci={ci ?? undefined}
      title={`Pull request #${pr.number}: ${what}`}
      onClick={() => window.drovr.link.open(pr.url)}
    >
      {ci !== null && <span className="card-pr-dot" aria-hidden="true" />}
      {open ? `#${pr.number}` : `#${pr.number} ${pr.state}`}
    </button>
  )
}

/**
 * A worktree card's Open pull request item (#38 D2, D3, D9): pushes the branch checked out in its
 * worktree now, then main opens GitHub's page for it, or the open PR's (`Push and open pull
 * request #<n>`). Disabled while the card's action runs and unless that worktree is on a branch
 * (`Not on a branch` when detached).
 */
function PullRequestItem({
  cardId,
  worktree,
  run
}: {
  cardId: string
  worktree: CardWorktree
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const branch = useBranch(worktree.path)
  const pr = usePullRequest(worktree.path, branch)
  const busy = useCardGitAction(cardId).busy !== null
  const onBranch = typeof branch === 'string' && branch !== 'detached'
  const disabled = busy || !onBranch
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      data-testid="card-menu-pull-request"
      aria-disabled={disabled || undefined}
      title={branch === 'detached' ? 'Not on a branch' : undefined}
      onClick={
        disabled
          ? undefined
          : run(() => {
              void runCardGitAction(cardId, 'Pushing…', () =>
                window.drovr.git.openPullRequest(worktree.path)
              ).then((result) => {
                if (result?.ok) refreshPullRequest(worktree.path)
              })
            })
      }
    >
      <GitPullRequest {...MENU_ICON} />
      {pr?.state === 'open' ? `Push and open pull request #${pr.number}` : 'Open pull request'}
    </button>
  )
}

/** A live branch read as a branch name: null when detached, not a repository or not read yet. */
const onBranch = (branch: string | null | undefined): string | null =>
  typeof branch === 'string' && branch !== 'detached' ? branch : null

/**
 * A worktree card's Merge into item (#38 D2, D10): `Merge into <branch>`, the workspace folder's
 * live branch, merging the branch checked out in the card's worktree now once confirmed
 * (`onChoose`). Disabled while the card's action runs, when the worktree is detached (`Not on a
 * branch`) and unless the workspace folder is on a branch.
 */
function MergeItem({
  cardId,
  worktree,
  run,
  onChoose
}: {
  cardId: string
  worktree: CardWorktree
  run: (action: () => void) => () => void
  onChoose: (choice: MergeChoice) => void
}): React.JSX.Element {
  const cardBranch = onBranch(useBranch(worktree.path))
  const branch = onBranch(useBranch(worktree.repo))
  const busy = useCardGitAction(cardId).busy !== null
  const choice = busy || cardBranch === null || branch === null ? null : { cardBranch, branch }
  const title =
    cardBranch === null
      ? 'Not on a branch'
      : branch === null
        ? 'The workspace folder is not on a branch'
        : undefined
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      data-testid="card-menu-merge"
      aria-disabled={choice === null || undefined}
      title={title}
      onClick={choice === null ? undefined : run(() => onChoose(choice))}
    >
      <GitMerge {...MENU_ICON} />
      {`Merge into ${branch ?? '…'}`}
    </button>
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
 * (#7 D3, D4), retries or skips a setup that is running or failed (#39 D6), or deletes it, asking first while its process runs. Alt+arrows move it (#6 D7); its body drags it to another place
 * on the board, dimmed meanwhile (#6 D5). A running card's stop button opens the same Close
 * confirmation (#31 D10). Its menu also opens it in its own window, or brings that window forward
 * (#53 D6); while it is there its status row has the `In window` chip (D7).
 */
function CardItem({ workspaceId, card, columns, drop, onOpen }: CardItemProps): React.JSX.Element {
  const status = useCardStatus(card.id)
  const running = useCardRunState(card.id).kind === 'running'
  const usage = useCardUsage(card.id)
  const inWindow = useInWindow(card.id)
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

  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [merging, setMerging] = useState<MergeChoice | null>(null)
  const merge = ({ cardBranch, branch }: MergeChoice): void => {
    setMerging(null)
    const worktree = card.worktree
    if (!worktree) return
    void runCardGitAction(card.id, 'Merging…', () =>
      window.drovr.git.merge(worktree.path, worktree.repo, cardBranch, branch)
    ).then((result) => {
      // The workspace folder's chips show what the merge left (D11).
      if (result) refreshBranch(worktree.repo)
    })
  }
  const onDelete = (): void => {
    if (card.worktree) {
      setDeletingWorktree(true)
      return
    }
    const message = cardDeleteConfirmation(card.title, cardTerminals().runState(card.id))
    if (message) setConfirm(message)
    else removeCard(workspaceId, card.id)
  }

  return (
    <li
      className={dragging ? 'card card-dragging' : 'card'}
      data-testid="card"
      data-card-id={card.id}
      data-kind={card.startup.kind}
      data-drop={drop}
    >
      <StartupTag startup={card.startup} watermark />
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
          <CardLines status={status} usage={usage} inWindow={inWindow} />
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
          <span className="card-head">
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
            </span>
            {card.worktree && <WorktreeBranch branch={card.worktree.branch} worktree />}
          </span>
          <CardLines status={status} usage={usage} inWindow={inWindow} />
        </button>
      )}
      {card.worktree && <PullRequestChip worktree={card.worktree} />}
      {card.worktree && <CardGitActionLine cardId={card.id} />}
      {running && <DevServerChips cardId={card.id} />}
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
          <Square size={12} fill="currentColor" aria-hidden="true" />
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
              <Pencil {...MENU_ICON} />
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
              <SquareTerminal {...MENU_ICON} />
              Startup command…
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="card-menu-open-window"
              onClick={run(() => {
                cancelPendingOpen()
                openCardWindow(workspaceId, card.id)
              })}
            >
              <AppWindow {...MENU_ICON} />
              Open in new window
            </button>
            {card.worktree && (
              <PullRequestItem cardId={card.id} worktree={card.worktree} run={run} />
            )}
            {card.worktree && (
              <MergeItem
                cardId={card.id}
                worktree={card.worktree}
                run={run}
                onChoose={(choice) => {
                  cancelPendingOpen()
                  setMerging(choice)
                }}
              />
            )}
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
                <Square {...MENU_ICON} />
                Close
              </button>
            )}
            {status.setup !== undefined && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid="card-menu-retry-setup"
                  onClick={run(() => retrySetup(workspaceId, card.id))}
                >
                  <RotateCw {...MENU_ICON} />
                  Retry setup
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid="card-menu-skip-setup"
                  onClick={run(() => skipSetup(workspaceId, card.id))}
                >
                  <SkipForward {...MENU_ICON} />
                  Skip setup
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item-danger"
              data-testid="card-menu-delete"
              onClick={run(onDelete)}
            >
              <Trash2 {...MENU_ICON} />
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
      {merging && card.worktree && (
        <MergeCardDialog
          worktree={card.worktree}
          choice={merging}
          onMerge={() => merge(merging)}
          onCancel={() => setMerging(null)}
        />
      )}
      {deletingWorktree && card.worktree && (
        <DeleteWorktreeCardDialog
          card={{ ...card, worktree: card.worktree }}
          running={running}
          onCancel={() => setDeletingWorktree(false)}
          onDelete={(remove, force) => {
            setDeletingWorktree(false)
            removeWorktreeCard(workspaceId, card, remove, force)
          }}
        />
      )}
    </li>
  )
}

export default CardItem
