import { useEffect, useRef, useState } from 'react'
import { keymapAction } from '../../core/keymap'
import { canSplit, MAIN_PANE, type SplitTree } from '../../core/split-tree'
import type { Card } from '../../core/workspace-store'
import CloseCardDialog from './CloseCardDialog'
import { currentKeymap } from './settings'
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

/**
 * One pane (#11 D1, D3, D5): its own screen, fitted to its area, focused by a click; an extra
 * pane has a close button in its top-right corner, shown while the pointer is over the pane or
 * the button has keyboard focus (#31 D3).
 */
function Pane({
  cardId,
  paneId,
  screen,
  focused
}: {
  cardId: string
  paneId: string
  screen: XtermScreen | undefined
  focused: boolean
}): React.JSX.Element {
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
        // Closing a pane isn't clicking into it: the focus stays where it was (D3).
        if ((event.target as Element).closest('.pane-close')) return
        cardPanes().focus(cardId, paneId)
      }}
    >
      <div className="pane-terminal" ref={hostRef} />
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
          ×
        </button>
      )}
    </div>
  )
}

/** The split tree (#11 D2): every split is 50/50, right side by side, down stacked. */
function PaneTree({
  cardId,
  tree,
  focused
}: {
  cardId: string
  tree: SplitTree
  focused: string
}): React.JSX.Element {
  if (tree.kind === 'leaf') {
    return (
      <Pane
        cardId={cardId}
        paneId={tree.id}
        screen={paneScreen(cardId, tree.id)}
        focused={tree.id === focused}
      />
    )
  }
  return (
    <div className={`pane-split pane-split-${tree.direction}`}>
      <PaneTree cardId={cardId} tree={tree.first} focused={focused} />
      <PaneTree cardId={cardId} tree={tree.second} focused={focused} />
    </div>
  )
}

/**
 * A card at full size (#4 D7): no bar (#31 D1), only the card's panes filling the area, its own
 * terminal first (#11 D1). Back, split and Close are its shortcuts (#31 D5); the title and status
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
    <section className="card-view" data-testid="card-view" aria-label={card.title}>
      <div className="card-view-terminal" data-testid="card-terminal">
        <PaneTree cardId={card.id} tree={layout.tree} focused={layout.focused} />
      </div>
      {closing && (
        <CloseCardDialog cardId={card.id} title={card.title} onDone={() => setClosing(false)} />
      )}
    </section>
  )
}

export default CardView
