import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { keymapAction } from '../../core/keymap'
import { canSplit, MAIN_PANE, paneIds, type SplitTree } from '../../core/split-tree'
import type { Card } from '../../core/workspace-store'
import CloseCardDialog from './CloseCardDialog'
import FindBar from './FindBar'
import { SMALL_ICON } from './icons'
import { currentKeymap, settingsStore, useSettings } from './settings'
import SidePanel from './SidePanel'
import {
  cardPanes,
  cardTerminals,
  usePaneLayout,
  useCardRunState,
  type XtermScreen
} from './card-terminals'

/** A pane's screen: the card's own terminal for the main pane, else the extra pane's. */
function paneScreen(cardId: string, paneId: string): XtermScreen | undefined {
  return paneId === MAIN_PANE ? cardTerminals().screen(cardId) : cardPanes().screen(cardId, paneId)
}

/** A dialog over the view owns the keyboard: nothing moves focus or acts on keys behind it. */
const dialogOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null

/** Gives the screen keyboard focus, unless a dialog is open over the view. */
function focusScreen(screen: XtermScreen | undefined): void {
  if (!dialogOpen()) screen?.focus()
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
  onCloseFind
}: {
  cardId: string
  paneId: string
  screen: XtermScreen | undefined
  focused: boolean
} & FindProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => screen?.attach(hostRef.current!), [screen])
  useEffect(() => {
    if (focused) focusScreen(screen)
  }, [focused, screen])
  return (
    <div
      className="pane"
      data-testid="pane"
      data-focused={focused}
      onMouseDownCapture={(event) => {
        // Closing a pane isn't clicking into it: the focus stays where it was (D3), nor is using
        // the find bar (#35 D3).
        if ((event.target as Element).closest('.pane-close, .find-bar')) return
        cardPanes().focus(cardId, paneId)
      }}
    >
      <div className="pane-terminal" ref={hostRef} />
      {screen && find?.paneId === paneId && (
        <FindBar
          screen={screen}
          focusRequest={find.request}
          onClose={onCloseFind}
          besideClose={paneId !== MAIN_PANE}
        />
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
            focusScreen(paneScreen(cardId, cardPanes().layout(cardId).focused))
          }}
        >
          <X {...SMALL_ICON} />
        </button>
      )}
    </div>
  )
}

/** The split tree (#11 D2): every split is 50/50, right side by side, down stacked. */
function PaneTree({
  cardId,
  tree,
  focused,
  ...findProps
}: {
  cardId: string
  tree: SplitTree
  focused: string
} & FindProps): React.JSX.Element {
  if (tree.kind === 'leaf') {
    return (
      <Pane
        cardId={cardId}
        paneId={tree.id}
        screen={paneScreen(cardId, tree.id)}
        focused={tree.id === focused}
        {...findProps}
      />
    )
  }
  return (
    <div className={`pane-split pane-split-${tree.direction}`}>
      <PaneTree cardId={cardId} tree={tree.first} focused={focused} {...findProps} />
      <PaneTree cardId={cardId} tree={tree.second} focused={focused} {...findProps} />
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
function CardView({ card, onBack }: { card: Card; onBack: () => void }): React.JSX.Element {
  const runState = useCardRunState(card.id)
  const [closing, setClosing] = useState(false)
  // A card that stops or fails while its Close dialog is open has nothing left to close.
  if (closing && runState.kind !== 'running') setClosing(false)
  const layout = usePaneLayout(card.id)

  // When the shell exits the card is Stopped and the view goes back to the board (#5 D6).
  const stopped = runState.kind === 'stopped'
  useEffect(() => {
    if (stopped) onBack()
  }, [stopped, onBack])

  const running = runState.kind === 'running'
  const splittable = running && canSplit(layout)
  const focusedPane = layout.focused
  const { sidePanelOpen } = useSettings()
  // The find bar (#35 D3, D10): never open when the view opens, gone when it goes away.
  const [find, setFind] = useState<OpenFind | null>(null)
  // The bar closes with the pane it searches (#35 D10); a closed pane's id is never kept.
  if (find && !paneIds(layout.tree).includes(find.paneId)) setFind(null)
  const closeFind = useCallback((): void => {
    const paneId = find?.paneId
    setFind(null)
    // Keyboard focus goes back to the searched pane's terminal (#35 D10).
    if (paneId !== undefined) focusScreen(paneScreen(card.id, paneId))
  }, [find, card.id])

  // The card's shortcuts (#31 D5). Capture phase: works wherever focus is, including the
  // terminal, which swallows the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      if (action === null || action === 'settings') return
      // A dialog over the view (e.g. deleting a workspace) owns the keyboard.
      if (dialogOpen()) return
      event.preventDefault()
      event.stopPropagation()
      // A held shortcut's auto-repeat is swallowed without acting again (D7).
      if (event.repeat) return
      if (action === 'back') onBack()
      // Find opens the bar on the focused pane, moves it there from another pane (keeping the
      // query and toggles; the old pane's highlights go with its bar) or, when it is there
      // already, focuses its field (#35 D2, D3); it does nothing in a pane with no screen (D12).
      else if (action === 'find') {
        if (paneScreen(card.id, focusedPane)) {
          setFind((open) => ({ paneId: focusedPane, request: (open?.request ?? 0) + 1 }))
        }
      }
      // The side panel shows or hides in every card at once (#55 D2, D3).
      else if (action === 'togglePanel') {
        settingsStore.update({ sidePanelOpen: !settingsStore.get().sidePanelOpen })
      }
      // Splitting acts only while the card runs and has fewer than 4 panes (#11 D4).
      else if (action === 'splitRight' || action === 'splitDown') {
        if (splittable) cardPanes().split(card, action === 'splitRight' ? 'right' : 'down')
      } else if (action === 'closePane' && focusedPane !== MAIN_PANE) {
        // An extra pane closes at once (D4); the focus moves to the pane that gets it.
        cardPanes().close(card.id, focusedPane)
        focusScreen(paneScreen(card.id, cardPanes().layout(card.id).focused))
      } else if (running) {
        // Close card, or Close pane in the main pane: the Close confirmation (#7), only while
        // the card runs.
        setClosing(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onBack, card, splittable, running, focusedPane])

  return (
    <div className="card-layout">
      <section className="card-view" data-testid="card-view" aria-label={card.title}>
        <div className="card-view-terminal" data-testid="card-terminal">
          <PaneTree
            cardId={card.id}
            tree={layout.tree}
            focused={layout.focused}
            find={find}
            onCloseFind={closeFind}
          />
        </div>
        {closing && (
          <CloseCardDialog cardId={card.id} title={card.title} onDone={() => setClosing(false)} />
        )}
      </section>
      {sidePanelOpen && (
        <SidePanel
          folder={card.directory}
          ssh={card.host !== undefined}
          onHide={() => {
            settingsStore.update({ sidePanelOpen: false })
            // The hide button is gone: keyboard focus goes back to the focused pane's terminal.
            focusScreen(paneScreen(card.id, cardPanes().layout(card.id).focused))
          }}
        />
      )}
    </div>
  )
}

export default CardView
