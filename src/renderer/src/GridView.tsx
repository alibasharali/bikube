import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useId, useState } from 'react'
import {
  GRID_FILTER_LABELS,
  GRID_FILTERS,
  gridSections,
  type GridFilter
} from '../../core/card-grid'
import type { Card, Workspace } from '../../core/workspace-store'
import { shownCards, showAllLabel } from '../../core/column-limit'
import { useWaitingQueue } from './attention'
import CardItem from './CardItem'
import { useRunningIds } from './card-terminals'
import { ICON, SMALL_ICON } from './icons'
import NewCard from './NewCard'
import { useNewCardRequest } from './new-card-request'
import { useSettings } from './settings'

/** Whether the Stopped section is open, for the run of the app, in every workspace. */
let stoppedOpen = true

/**
 * The sections unfolded with Show all, as `<workspace id>:<section>`, for the run of the app (kept
 * across Back, as a board column's).
 */
const expandedSections = new Set<string>()

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
  // Card display limit: each section shows its first this many, as a board column does.
  const limit = useSettings().columnCardLimit
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(expandedSections))
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
  // The command palette's New card opens the dialog here, as on the board (#40 D9, #69 D3).
  const newCardRequest = useNewCardRequest(workspace.id, firstColumn !== undefined)

  const toggleStopped = (): void => {
    stoppedOpen = !showStopped
    setShowStopped(stoppedOpen)
  }

  const grid = (section: GridFilter, cards: Card[]): React.JSX.Element => {
    const key = `${workspace.id}:${section}`
    const open = expanded.has(key)
    const label = showAllLabel(cards.length, open, limit)
    const toggle = (): void => {
      if (open) expandedSections.delete(key)
      else expandedSections.add(key)
      setExpanded(new Set(expandedSections))
    }
    return (
      <>
        <ul className="card-grid">
          {shownCards(cards, open, limit).map((card) => (
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
        {label && (
          <button
            type="button"
            className="column-show-all"
            data-testid="grid-show-all"
            aria-expanded={open}
            onClick={toggle}
          >
            {label}
          </button>
        )}
      </>
    )
  }

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
              columnName={firstColumn.name}
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
            {grid('waiting', sections.waiting)}
          </section>
        )}
        {sections.running.length > 0 && (
          <section className="grid-section" data-testid="grid-section-running">
            <h2 className="grid-section-title">
              {GRID_FILTER_LABELS.running}
              <span className="count">{sections.running.length}</span>
            </h2>
            {grid('running', sections.running)}
          </section>
        )}
        {sections.stopped.length > 0 && filter === 'stopped' && (
          // Picked on its own, the section is all there is: never folded.
          <section className="grid-section" data-testid="grid-section-stopped">
            <h2 className="grid-section-title">
              {GRID_FILTER_LABELS.stopped}
              <span className="count">{sections.stopped.length}</span>
            </h2>
            {grid('stopped', sections.stopped)}
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
            {showStopped && grid('stopped', sections.stopped)}
          </section>
        )}
      </div>
    </section>
  )
}

export default GridView
