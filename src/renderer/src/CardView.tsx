import { useEffect, useRef, useState } from 'react'
import { isBackShortcut } from '../../core/card-shortcuts'
import type { Card } from '../../core/workspace-store'
import CardStatusLine from './CardStatusLine'
import CloseCardDialog from './CloseCardDialog'
import { cardTerminals, useCardRunState, useCardStatus } from './card-terminals'

/**
 * A card at full size (#4 D7): header with title, status, Back and, while it runs, Close
 * (#7 D3, D4); the card's own terminal fitted below. Leaving only detaches the screen; the
 * process keeps running (D8, D10). When the shell exits, the view goes back to the board
 * (#5 D6), including after Close.
 */
function CardView({ card, onBack }: { card: Card; onBack: () => void }): React.JSX.Element {
  const status = useCardStatus(card.id)
  const runState = useCardRunState(card.id)
  const [closing, setClosing] = useState(false)
  // A card that stops or fails while its Close dialog is open has nothing left to close.
  if (closing && runState.kind !== 'running') setClosing(false)
  const hostRef = useRef<HTMLDivElement>(null)
  // Each start gets a new screen (#5 D7); a Stopped card has none (#5 D6).
  const screen = cardTerminals().screen(card.id)

  useEffect(() => {
    if (!screen) return
    const detach = screen.attach(hostRef.current!)
    screen.focus()
    return detach
  }, [screen])

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
          <button
            type="button"
            className="btn btn-small"
            data-testid="card-close"
            onClick={() => setClosing(true)}
          >
            Close
          </button>
        )}
      </header>
      <div className="card-view-terminal" data-testid="card-terminal" ref={hostRef} />
      {closing && (
        <CloseCardDialog cardId={card.id} title={card.title} onDone={() => setClosing(false)} />
      )}
    </section>
  )
}

export default CardView
