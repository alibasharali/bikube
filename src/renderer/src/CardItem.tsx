import type { Card } from '../../core/workspace-store'
import CardStatusLine from './CardStatusLine'
import { useCardStatus } from './card-terminals'

/** A card on the board: its title and status; click or Enter opens it (#4 D5, D7, D9). */
function CardItem({ card, onOpen }: { card: Card; onOpen: () => void }): React.JSX.Element {
  const status = useCardStatus(card.id)
  return (
    <li className="card" data-testid="card" data-card-id={card.id}>
      <button
        type="button"
        className="card-open"
        data-testid="card-open"
        aria-label={`Open ${card.title}`}
        onClick={onOpen}
      >
        <span className="card-title" data-testid="card-title" title={card.title}>
          {card.title}
        </span>
        <CardStatusLine status={status} />
      </button>
    </li>
  )
}

export default CardItem
