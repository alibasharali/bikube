import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useId, useState } from 'react'
import {
  GRID_FILTER_LABELS,
  GRID_FILTERS,
  gridSections,
  type GridFilter
} from '../../core/card-grid'
import type { Card, Workspace } from '../../core/workspace-store'
import { useWaitingQueue } from './attention'
import CardItem from './CardItem'
import { useRunningIds } from './card-terminals'
import { ICON, SMALL_ICON } from './icons'
import NewCard from './NewCard'
import { useNewCardRequest } from './new-card-request'

/** Whether the Stopped section is open, for the run of the app, in every workspace. */
let stoppedOpen = true

/**
 * The grid view of a workspace: every card in one grid, latest first, instead of its columns.
 * Cards waiting for the user come first, then the other running ones, then the stopped ones in a
 * section that folds. A search and a filter narrow them. The cards are the board's own: they keep
 * their columns, and a new one goes to the bottom of the first.
 */
function GridView({
  workspace,
  onOpenCard
}: {
  workspace: Workspace
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  const id = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<GridFilter>('all')
  const [showStopped, setShowStopped] = useState(stoppedOpen)
  const running = useRunningIds(workspace.cards)
  const waitingQueue = useWaitingQueue()
  const waiting = new Set(waitingQueue)
  const state = {
    isRunning: (c: string) => running.has(c),
    isWaiting: (c: string) => waiting.has(c)
  }
  const sections = gridSections(workspace.cards, state, query, filter)
  // Each filter's count follows the search, so it says what picking it would show.
  const counts = gridSections(workspace.cards, state, query, 'all')
  const count = (f: GridFilter): number =>
    f === 'all'
      ? counts.waiting.length + counts.running.length + counts.stopped.length
      : counts[f].length
  const shown = sections.waiting.length + sections.running.length + sections.stopped.length
  const firstColumn = workspace.columns[0]
  // The command palette's New card opens the form here, as on the board (#40 D9).
  const newCardRequest = useNewCardRequest(workspace.id, firstColumn !== undefined)

  const toggleStopped = (): void => {
    stoppedOpen = !showStopped
    setShowStopped(stoppedOpen)
  }

  const grid = (cards: Card[]): React.JSX.Element => (
    <ul className="card-grid">
      {cards.map((card) => (
        <CardItem
          key={card.id}
          workspaceId={workspace.id}
          card={card}
          columns={workspace.columns}
          movable={false}
          onOpen={() => onOpenCard(card.id)}
        />
      ))}
    </ul>
  )

  return (
    <section
      className="board grid-view"
      data-testid="grid-view"
      aria-label={`Cards in ${workspace.name}`}
    >
      <h1 className="visually-hidden">{workspace.name}</h1>
      <div className="grid-toolbar">
        <label className="grid-search">
          <Search {...SMALL_ICON} />
          <span className="visually-hidden">Search cards</span>
          <input
            type="search"
            data-testid="grid-search"
            placeholder="Search cards"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears the search first, as a search field does.
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
        </label>
        <div className="segmented grid-filter" role="radiogroup" aria-label="Show">
          {GRID_FILTERS.map((f) => (
            <label key={f} className="radio" data-testid={`grid-filter-${f}`}>
              <input
                type="radio"
                name={`${id}-filter`}
                value={f}
                checked={filter === f}
                onChange={() => setFilter(f)}
              />
              {GRID_FILTER_LABELS[f]}
              <span className="grid-filter-count" data-testid="grid-filter-count">
                {count(f)}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid-scroll">
        {firstColumn && (
          <div className="grid-new-card">
            <NewCard
              workspaceId={workspace.id}
              columnId={firstColumn.id}
              defaultStartup={workspace.defaultStartup}
              onCreated={onOpenCard}
              openRequest={newCardRequest}
            />
          </div>
        )}
        {workspace.cards.length === 0 ? (
          <p className="column-empty grid-empty" data-testid="grid-empty">
            No cards yet
          </p>
        ) : shown === 0 ? (
          <p className="column-empty grid-empty" data-testid="grid-empty">
            No cards match
          </p>
        ) : null}
        {sections.waiting.length > 0 && (
          <section className="grid-section" data-testid="grid-section-waiting">
            <h2 className="grid-section-title">
              {GRID_FILTER_LABELS.waiting}
              <span className="count">{sections.waiting.length}</span>
            </h2>
            {grid(sections.waiting)}
          </section>
        )}
        {sections.running.length > 0 && (
          <section className="grid-section" data-testid="grid-section-running">
            <h2 className="grid-section-title">
              {GRID_FILTER_LABELS.running}
              <span className="count">{sections.running.length}</span>
            </h2>
            {grid(sections.running)}
          </section>
        )}
        {sections.stopped.length > 0 && filter === 'stopped' && (
          // Picked on its own, the section is all there is: never folded.
          <section className="grid-section" data-testid="grid-section-stopped">
            <h2 className="grid-section-title">
              {GRID_FILTER_LABELS.stopped}
              <span className="count">{sections.stopped.length}</span>
            </h2>
            {grid(sections.stopped)}
          </section>
        )}
        {sections.stopped.length > 0 && filter !== 'stopped' && (
          <section className="grid-section" data-testid="grid-section-stopped">
            <h2 className="grid-section-title">
              <button
                type="button"
                className="grid-section-toggle"
                data-testid="grid-stopped-toggle"
                aria-expanded={showStopped}
                onClick={toggleStopped}
              >
                {showStopped ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
                {GRID_FILTER_LABELS.stopped}
                <span className="count">{sections.stopped.length}</span>
              </button>
            </h2>
            {showStopped && grid(sections.stopped)}
          </section>
        )}
      </div>
    </section>
  )
}

export default GridView
