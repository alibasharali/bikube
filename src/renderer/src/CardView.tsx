import { X } from 'lucide-react'
import { markOpened } from './background-shells'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SPAWN_REFUSAL } from '../../core/spawn-refusals'
import { keymapAction } from '../../core/keymap'
import { canSplit, MAIN_PANE, paneIds, type SplitTree } from '../../core/split-tree'
import type { Card } from '../../core/workspace-store'
import { requestCloseCard, runPendingInWorkspaceFolder, startCard } from './card-actions'
import { usePendingWorktree, type PendingWorktreeRun } from './pending-worktrees'
import CloseCardDialog from './CloseCardDialog'
import DescriptionDialog from './DescriptionDialog'
import RenameCardDialog from './RenameCardDialog'
import RemoveWorktreeDialog from './RemoveWorktreeDialog'
import FindBar from './FindBar'
import { SMALL_ICON } from './icons'
import { isCardViewAction, registerCardViewActions, type CardViewAction } from './card-view-actions'
import { currentKeymap, settingsStore, useEffectiveSettings, useSettings } from './settings'
import { workspaceStore } from './store'
import SidePanel from './SidePanel'
import {
  cardPanes,
  cardTerminals,
  usePaneLayout,
  useCardRunState,
  useTerminalBackground,
  type XtermScreen
} from './card-terminals'
import { dialogOpenIn, useViewWindow } from './view-window'

/** A pane's screen: the card's own terminal for the main pane, else the extra pane's. */
function paneScreen(cardId: string, paneId: string): XtermScreen | undefined {
  return paneId === MAIN_PANE ? cardTerminals().screen(cardId) : cardPanes().screen(cardId, paneId)
}

/**
 * Gives the screen keyboard focus, unless a dialog is open over the view: it owns the keyboard of
 * `view`, the window the view is in (#53 D5).
 */
function focusScreen(screen: XtermScreen | undefined, view: Window): void {
  if (!dialogOpenIn(view)) screen?.focus()
}

/** The view's find bar (#35 D3): the pane it searches; `request` counts the Find presses. */
interface OpenFind {
  paneId: string
  request: number
}

/** What a pane needs to show the view's find bar on itself (#35 D3, D10). */
interface FindProps {
  find: OpenFind | null
  onCloseFind: () => void
}

/**
 * The view's zoom (#48 D1, D5): undefined unless zoomed, else its pane count for the chip. While
 * zoomed only the focused pane shows; the others stay mounted, hidden (D2).
 */
interface ZoomProps {
  zoomedPanes?: number
}

/**
 * How split panes look: an unfocused pane's dim, 0 (none) to 0.85, as the share of the terminal's
 * background laid over it (Ghostty's `unfocused-split-opacity`), and whether the pointer hides
 * while typing.
 */
interface PaneLookProps {
  dim: number
  hideMouseWhileTyping: boolean
}

/**
 * A card's pending worktree at its first open (#69 D10), in place of its panes: being made, or
 * git's reason it failed with Retry and Run in workspace folder (which drops it).
 */
function PendingWorktreeView({
  run,
  branch,
  onRetry,
  onRunInFolder
}: {
  run: PendingWorktreeRun
  branch: string | undefined
  onRetry: () => void
  onRunInFolder: () => void
}): React.JSX.Element {
  if (run.kind === 'making') {
    return (
      <div className="empty-state" data-testid="pending-worktree" role="status">
        <h1>Making its worktree…</h1>
        <p>
          A new branch{branch ? ` ${branch}` : ''} from the workspace folder, with ignored files
          copied. The card starts there once it is ready.
        </p>
      </div>
    )
  }
  return (
    <div className="empty-state" data-testid="pending-worktree">
      <h1>Couldn’t make its worktree</h1>
      <p role="alert" data-testid="pending-worktree-error">
        {run.reason}
      </p>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          data-testid="pending-worktree-folder"
          onClick={onRunInFolder}
        >
          Run in workspace folder
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="pending-worktree-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  )
}

/**
 * One pane (#11 D1, D3, D5): its own screen, fitted to its area, focused by a click; an extra
 * pane has a close button in its top-right corner, shown while the pointer is over the pane or
 * the button has keyboard focus (#31 D3). The find bar shows in the pane it searches, left of
 * that button (#35 D3).
 */
function Pane({
  cardId,
  paneId,
  screen,
  focused,
  find,
  onCloseFind,
  zoomedPanes,
  onCloseCard,
  dim,
  hideMouseWhileTyping,
  grow
}: {
  cardId: string
  paneId: string
  screen: XtermScreen | undefined
  focused: boolean
  /** Its share of its split, as a flex grow; absent for an equal one. */
  grow?: number
} & FindProps &
  ZoomProps &
  PaneLookProps &
  CloseCardProps): React.JSX.Element {
  // The main pane's close button closes the card, as Close pane does there; extra panes close.
  const closeCard = paneId === MAIN_PANE ? onCloseCard : undefined
  const view = useViewWindow()
  const hostRef = useRef<HTMLDivElement>(null)
  const fill = useTerminalBackground()
  // Typing hides the pointer until it moves (Ghostty's `mouse-hide-while-typing`).
  const [typing, setTyping] = useState(false)
  if (typing && !hideMouseWhileTyping) setTyping(false)
  useEffect(() => screen?.attach(hostRef.current!), [screen])
  useEffect(() => {
    if (focused) focusScreen(screen, view)
  }, [focused, screen, view])
  return (
    <div
      className="pane"
      data-testid="pane"
      data-focused={focused}
      data-typing={typing || undefined}
      hidden={zoomedPanes !== undefined && !focused}
      style={grow === undefined ? undefined : { flexGrow: grow }}
      onKeyDownCapture={() => {
        if (hideMouseWhileTyping && !typing) setTyping(true)
      }}
      onMouseMove={() => {
        if (typing) setTyping(false)
      }}
      onMouseDownCapture={(event) => {
        // Closing a pane isn't clicking into it: the focus stays where it was (D3). Using the
        // find bar is: the pane it searches is the focused one (#35 D3, D10).
        if ((event.target as Element).closest('.pane-close')) return
        cardPanes().focus(cardId, paneId)
      }}
    >
      <div className="pane-terminal" ref={hostRef} />
      {dim > 0 && !focused && (
        <div
          className="pane-dim"
          data-testid="pane-dim"
          style={{ background: fill, opacity: dim }}
        />
      )}
      {zoomedPanes !== undefined && focused && (
        <button
          type="button"
          className="pane-zoom"
          data-testid="pane-zoom"
          title="Show all panes"
          onClick={() => {
            // Ends the zoom; the keyboard goes back to the pane's terminal (#48 D5).
            cardPanes().toggleZoom(cardId)
            focusScreen(screen, view)
          }}
        >
          Zoomed · {zoomedPanes} panes
        </button>
      )}
      {screen && find?.paneId === paneId && (
        <FindBar
          screen={screen}
          focusRequest={find.request}
          onClose={onCloseFind}
          besideClose={paneId !== MAIN_PANE || closeCard !== undefined}
        />
      )}
      {closeCard && (
        <button
          type="button"
          className="pane-close"
          data-testid="pane-close-card"
          aria-label="Close card"
          title="Close card"
          onClick={closeCard}
        >
          <X {...SMALL_ICON} />
        </button>
      )}
      {paneId !== MAIN_PANE && (
        <button
          type="button"
          className="pane-close"
          data-testid="pane-close"
          aria-label="Close pane"
          title="Close pane"
          onClick={() => {
            cardPanes().close(cardId, paneId)
            // The button is gone: keyboard focus goes back to the focused pane's terminal.
            focusScreen(paneScreen(cardId, cardPanes().layout(cardId).focused), view)
          }}
        >
          <X {...SMALL_ICON} />
        </button>
      )}
    </div>
  )
}

/** The main pane's close button, which asks to close the card as Close pane does there. */
interface CloseCardProps {
  onCloseCard?: () => void
}

/**
 * The split tree (#11 D2): right side by side, down stacked, 50/50 until resized (each side's
 * share as its flex grow).
 */
function PaneTree({
  cardId,
  tree,
  focused,
  grow,
  ...findProps
}: {
  cardId: string
  tree: SplitTree
  focused: string
  grow?: number
} & FindProps &
  ZoomProps &
  PaneLookProps &
  CloseCardProps): React.JSX.Element {
  if (tree.kind === 'leaf') {
    return (
      <Pane
        cardId={cardId}
        paneId={tree.id}
        screen={paneScreen(cardId, tree.id)}
        focused={tree.id === focused}
        grow={grow}
        {...findProps}
      />
    )
  }
  // While zoomed, a split without the focused pane takes no space (#48 D1).
  const hidden = findProps.zoomedPanes !== undefined && !paneIds(tree).includes(focused)
  const ratio = tree.ratio
  return (
    <div
      className={`pane-split pane-split-${tree.direction}`}
      hidden={hidden}
      style={grow === undefined ? undefined : { flexGrow: grow }}
    >
      <PaneTree cardId={cardId} tree={tree.first} focused={focused} grow={ratio} {...findProps} />
      <PaneTree
        cardId={cardId}
        tree={tree.second}
        focused={focused}
        grow={ratio === undefined ? undefined : 1 - ratio}
        {...findProps}
      />
    </div>
  )
}

/**
 * A card at full size (#4 D7): no bar (#31 D1), only the card's panes filling the area, its own
 * terminal first (#11 D1); the side panel sits beside the view, at its right, while it is shown
 * (#55 D1). Back, split and Close are its shortcuts (#31 D5); the title and status
 * show on the board. Leaving only detaches the screens; the processes keep running (D8, D10).
 * When the shell exits, the view goes back to the board (#5 D6), including after Close.
 */
function CardView({
  card,
  workspaceId,
  onBack,
  onOpenInWindow,
  onOpenShell
}: {
  card: Card
  /** The workspace the card or shell is in. */
  workspaceId: string
  onBack: () => void
  /** Opens a shell from the side panel's Shells tab. */
  onOpenShell: (shellId: string) => void
  /** Opens the card in its own window (#53 D6); none in a card window, where it does nothing (D5). */
  onOpenInWindow?: () => void
}): React.JSX.Element {
  // The main window, or the card's own window (#53 D5): its keys, dialogs and focus are that one's.
  const view = useViewWindow()
  const runState = useCardRunState(card.id)
  // Shown here, a trigger is listed in the sidebar from now on.
  useEffect(() => markOpened(card.id), [card.id])
  const [closing, setClosing] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // A card that stops or fails while its Close dialog is open has nothing left to close.
  if (closing && runState.kind !== 'running') setClosing(false)
  const layout = usePaneLayout(card.id)
  // A worktree card whose folder is gone can't start: offer to run it in the workspace folder.
  const worktreeGone =
    runState.kind === 'failed' &&
    runState.reason === SPAWN_REFUSAL.directoryNotFound &&
    card.worktree !== undefined &&
    card.host === undefined
  const [goneDismissed, setGoneDismissed] = useState(false)
  if (goneDismissed && !worktreeGone) setGoneDismissed(false)

  // Its pending worktree being made or failed (#69 D10): the card isn't started yet.
  const pendingRun = usePendingWorktree(card.id)
  const awaitingWorktree = pendingRun !== undefined && runState.kind !== 'running'

  // When the shell exits the card is Stopped and the view goes back to the board (#5 D6).
  const stopped = runState.kind === 'stopped' && pendingRun === undefined
  useEffect(() => {
    if (stopped) onBack()
  }, [stopped, onBack])

  const running = runState.kind === 'running'
  const splittable = running && canSplit(layout)
  const focusedPane = layout.focused
  const { sidePanelOpen } = useSettings()
  const { unfocusedPaneOpacity, paneDividerColor, hideMouseWhileTyping } = useEffectiveSettings()
  // The find bar (#35 D3, D10): never open when the view opens, gone when it goes away.
  const [find, setFind] = useState<OpenFind | null>(null)
  // The bar closes with the pane it searches (#35 D10); a closed pane's id is never kept.
  if (find && !paneIds(layout.tree).includes(find.paneId)) setFind(null)
  const closeFind = useCallback((): void => {
    const paneId = find?.paneId
    setFind(null)
    // Keyboard focus goes back to the searched pane's terminal, the focused pane (#35 D10).
    if (paneId === undefined) return
    cardPanes().focus(card.id, paneId)
    focusScreen(paneScreen(card.id, paneId), view)
  }, [find, card.id, view])

  // The card's actions (#31 D5), run by its shortcuts and the command palette (#40 D6). The
  // listener stays put while the view does and calls the latest `run`: a shell's `card` is a new
  // object on every render, and a listener re-added mid-dispatch (a re-render from the Cmd keydown
  // before it) would miss the key that follows.
  const runAction = useRef<(action: CardViewAction) => void>(() => {})
  useEffect(() => {
    runAction.current = (action: CardViewAction): void => {
      if (action === 'back') onBack()
      // Find opens the bar on the focused pane, moves it there from another pane (keeping the
      // query and toggles; the old pane's highlights go with its bar) or, when it is there
      // already, focuses its field (#35 D2, D3); it does nothing in a pane with no screen (D12).
      else if (action === 'find') {
        if (paneScreen(card.id, focusedPane)) {
          setFind((open) => ({ paneId: focusedPane, request: (open?.request ?? 0) + 1 }))
        }
      }
      // The focused pane scrolls to its previous or next prompt (#45 D5); its shell never gets the
      // keys, also when nothing happens.
      else if (action === 'previousPrompt' || action === 'nextPrompt') {
        paneScreen(card.id, focusedPane)?.jumpToPrompt(
          action === 'previousPrompt' ? 'previous' : 'next'
        )
      }
      // Selects and copies a command's output in the focused pane (#60 D2); nothing without one
      // (D4), and the shell never gets the keys.
      else if (action === 'copyCommandOutput') paneScreen(card.id, focusedPane)?.copyCommandOutput()
      // Zooms the focused pane or ends the zoom (#48 D3); the terminal keeps the keyboard.
      else if (action === 'zoomPane') cardPanes().toggleZoom(card.id)
      // Pane moves and sizes (Ghostty's goto_split, equalize_splits, resize_split); the
      // terminal keeps the keyboard, the newly focused one's once it moves.
      else if (action === 'focusNextPane') cardPanes().focusAdjacent(card.id, 1)
      else if (action === 'focusPreviousPane') cardPanes().focusAdjacent(card.id, -1)
      else if (action === 'equalizePanes') cardPanes().equalize(card.id)
      else if (action === 'resizePaneLeft') cardPanes().resize(card.id, 'left')
      else if (action === 'resizePaneRight') cardPanes().resize(card.id, 'right')
      else if (action === 'resizePaneUp') cardPanes().resize(card.id, 'up')
      else if (action === 'resizePaneDown') cardPanes().resize(card.id, 'down')
      // Ghostty's prompt_surface_title: a card's title (a shell has none of its own here).
      else if (action === 'renameCard') {
        const ws = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
        if (ws?.cards.some((c) => c.id === card.id)) setRenaming(true)
      } else if (action === 'openInWindow') onOpenInWindow?.()
      // The open card has no menu (#31 D1): the palette edits its description (#69 D4); a
      // shell has none.
      else if (action === 'editDescription') {
        const ws = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
        if (ws?.cards.some((c) => c.id === card.id)) setEditingDescription(true)
      }
      // Splitting acts only while the card runs and has fewer than 4 panes (#11 D4); it ends a
      // zoom (#48 D4).
      else if (action === 'splitRight' || action === 'splitDown') {
        if (splittable) cardPanes().split(card, action === 'splitRight' ? 'right' : 'down')
      } else if (action === 'closePane' && focusedPane !== MAIN_PANE) {
        // An extra pane closes at once (D4); the focus moves to the pane that gets it.
        cardPanes().close(card.id, focusedPane)
        focusScreen(paneScreen(card.id, cardPanes().layout(card.id).focused), view)
      } else if (running) {
        // Close card, or Close pane in the main pane: the Close confirmation (#7), only while
        // the card runs.
        requestCloseCard(card.id, () => setClosing(true))
      }
    }
  }, [onBack, onOpenInWindow, card, splittable, running, focusedPane, view, workspaceId])
  useEffect(() => {
    const run = (action: CardViewAction): void => runAction.current(action)
    // Capture phase: works wherever focus is, including the terminal, which swallows the key.
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      // Settings, the Default shell, the command palette and Toggle panel are the app's (#40 D1,
      // #57 D4).
      if (!isCardViewAction(action)) return
      // A dialog over the view (e.g. deleting a workspace) owns the keyboard.
      if (dialogOpenIn(view)) return
      event.preventDefault()
      event.stopPropagation()
      // A held shortcut's auto-repeat is swallowed without acting again (D7).
      if (event.repeat) return
      run(action)
    }
    view.addEventListener('keydown', onKeyDown, true)
    // The palette's card view actions act on the main window's open card only (#53 D5).
    const unregister = view === window ? registerCardViewActions(run) : () => {}
    return () => {
      view.removeEventListener('keydown', onKeyDown, true)
      unregister()
    }
  }, [view])

  return (
    <div className="card-layout">
      <section className="card-view" data-testid="card-view" aria-label={card.title}>
        <div
          className="card-view-terminal"
          data-testid="card-terminal"
          data-zoomed={layout.zoomed === true}
          style={
            paneDividerColor === ''
              ? undefined
              : ({ '--pane-divider': paneDividerColor } as React.CSSProperties)
          }
        >
          {awaitingWorktree ? (
            <PendingWorktreeView
              run={pendingRun}
              branch={card.pendingWorktree?.branch}
              onRetry={() => startCard(workspaceId, card.id)}
              onRunInFolder={() => runPendingInWorkspaceFolder(workspaceId, card.id)}
            />
          ) : (
            <PaneTree
              cardId={card.id}
              tree={layout.tree}
              focused={layout.focused}
              find={find}
              onCloseFind={closeFind}
              zoomedPanes={layout.zoomed ? paneIds(layout.tree).length : undefined}
              dim={layout.zoomed || paneIds(layout.tree).length < 2 ? 0 : 1 - unfocusedPaneOpacity}
              hideMouseWhileTyping={hideMouseWhileTyping}
              // Close card, whichever pane is focused: Close pane in the main pane asks the same.
              // Only while it runs, as both do nothing on a stopped card.
              onCloseCard={running ? () => runAction.current('closeCard') : undefined}
            />
          )}
        </div>
        {editingDescription && (
          <DescriptionDialog
            workspaceId={workspaceId}
            card={card}
            onClose={() => setEditingDescription(false)}
          />
        )}
        {renaming && (
          <RenameCardDialog
            workspaceId={workspaceId}
            card={card}
            onClose={() => {
              setRenaming(false)
              focusScreen(paneScreen(card.id, cardPanes().layout(card.id).focused), view)
            }}
          />
        )}
        {closing && (
          <CloseCardDialog cardId={card.id} title={card.title} onDone={() => setClosing(false)} />
        )}
        {worktreeGone && !goneDismissed && card.worktree && (
          <RemoveWorktreeDialog
            workspaceId={workspaceId}
            card={{ ...card, worktree: card.worktree }}
            gone
            onDone={() => setGoneDismissed(true)}
          />
        )}
      </section>
      {sidePanelOpen && (
        <SidePanel
          folder={card.directory}
          ssh={card.host !== undefined}
          workspaceId={workspaceId}
          openCard={card}
          onOpenShell={onOpenShell}
          // A card window has no title bar: the panel shows its own tabs and button.
          header={view !== window}
          onHide={() => {
            settingsStore.update({ sidePanelOpen: false })
            // The panel's show/hide button (a card window's) is gone with it: keyboard focus goes
            // back to the focused pane's terminal.
            focusScreen(paneScreen(card.id, cardPanes().layout(card.id).focused), view)
          }}
        />
      )}
    </div>
  )
}

export default CardView
