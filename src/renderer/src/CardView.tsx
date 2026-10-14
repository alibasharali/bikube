import { useEffect, useRef, useState } from 'react'
import { isBackShortcut } from '../../core/card-shortcuts'
import { MAIN_PANE, type SplitTree } from '../../core/split-tree'
import type { Card } from '../../core/workspace-store'
import CardStatusLine from './CardStatusLine'
import CloseCardDialog from './CloseCardDialog'
import {
  cardPanes,
  cardTerminals,
  usePaneLayout,
  useCardRunState,
  useCardStatus,
  type XtermScreen
} from './card-terminals'

/**
 * One pane (#11 D1, D3, D5): its own screen, fitted to its area, focused by a click; an extra
 * pane has a close button in its top-right corner.
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
    if (focused) screen?.focus()
  }, [focused, screen])
  return (
    <div
      className="pane"
      data-testid="pane"
      data-focused={focused}
      onMouseDownCapture={() => cardPanes().focus(cardId, paneId)}
    >
      <div className="pane-terminal" ref={hostRef} />
      {paneId !== MAIN_PANE && (
        <button
          type="button"
          className="pane-close"
          data-testid="pane-close"
          aria-label="Close pane"
          title="Close pane"
          onClick={() => cardPanes().close(cardId, paneId)}
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
    const screen =
      tree.id === MAIN_PANE ? cardTerminals().screen(cardId) : cardPanes().screen(cardId, tree.id)
    return <Pane cardId={cardId} paneId={tree.id} screen={screen} focused={tree.id === focused} />
  }
  return (
    <div className={`pane-split pane-split-${tree.direction}`}>
      <PaneTree cardId={cardId} tree={tree.first} focused={focused} />
      <PaneTree cardId={cardId} tree={tree.second} focused={focused} />
    </div>
  )
}

/**
 * A card at full size (#4 D7): header with title, status, Back and, while it runs, Close
 * (#7 D3, D4) and the split buttons (#11 D2); the card's panes fitted below, its own terminal
 * first (#11 D1). Leaving only detaches the screens; the processes keep running (D8, D10). When the shell exits, the view goes back to the board
 * (#5 D6), including after Close.
 */
function CardView({ card, onBack }: { card: Card; onBack: () => void }): React.JSX.Element {
  const status = useCardStatus(card.id)
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

  // Capture phase: works wherever focus is, including the terminal, which swallows the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isBackShortcut(event, window.drovr.platform)) return
      // A dialog over the view (e.g. deleting a workspace) owns the keyboard.
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      onBack()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onBack])

  return (
    <section className="card-view" data-testid="card-view" aria-label={card.title}>
      <header className="card-view-header">
        <h1 className="card-view-title" data-testid="card-view-title" title={card.title}>
          {card.title}
        </h1>
        <CardStatusLine status={status} className="card-view-status" />
        <button type="button" className="btn btn-small" data-testid="card-back" onClick={onBack}>
          Back
        </button>
        {runState.kind === 'running' && (
          <>
            <button
              type="button"
              className="btn btn-small"
              data-testid="pane-split-right"
              onClick={() => cardPanes().split(card, 'right')}
            >
              Split right
            </button>
            <button
              type="button"
              className="btn btn-small"
              data-testid="pane-split-down"
              onClick={() => cardPanes().split(card, 'down')}
            >
              Split down
            </button>
            <button
              type="button"
              className="btn btn-small"
              data-testid="card-close"
              onClick={() => setClosing(true)}
            >
              Close
            </button>
          </>
        )}
      </header>
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
