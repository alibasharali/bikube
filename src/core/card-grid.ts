/**
 * The grid view's cards: a workspace's cards in one grid instead of its columns, latest first, in
 * three sections (cards waiting for the user, other running cards, stopped cards), narrowed by a
 * search and a filter. Plain TS, no DOM: the renderer passes which cards run and wait.
 */
import { AGENT_PRESETS } from './agent-presets'
import type { Card } from './workspace-store'

/** The grid's filter: every card, or one section's. */
export const GRID_FILTERS = ['all', 'waiting', 'running', 'stopped'] as const
export type GridFilter = (typeof GRID_FILTERS)[number]

export const GRID_FILTER_LABELS: Record<GridFilter, string> = {
  all: 'All',
  waiting: 'Needs you',
  running: 'Running',
  stopped: 'Stopped'
}

export interface GridSections {
  /** Running cards whose agent waits for the user (#41's queue). */
  waiting: Card[]
  /** Running cards not waiting. */
  running: Card[]
  stopped: Card[]
}

/** When the card was last created or opened (here), or undefined for a card from before both. */
function latest(card: Card): number | undefined {
  const { createdAt, lastOpenedAt } = card
  if (createdAt === undefined) return lastOpenedAt
  return lastOpenedAt === undefined ? createdAt : Math.max(createdAt, lastOpenedAt)
}

/**
 * The cards latest first: by when each was created or last opened on this machine, newest first,
 * then the cards with neither (from before them), the last on the board first. Ties keep the
 * later card first.
 */
export function latestFirst(cards: readonly Card[]): Card[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const at = latest(a.card)
      const bt = latest(b.card)
      if (at !== undefined && bt !== undefined && at !== bt) return bt - at
      if (at === undefined && bt !== undefined) return 1
      if (at !== undefined && bt === undefined) return -1
      return b.index - a.index
    })
    .map(({ card }) => card)
}

/** What the search reads of a card: its title, its worktree's branch and its agent's name. */
function searchable(card: Card): string {
  const { startup } = card
  const agent =
    startup.kind === 'claude'
      ? 'Claude Code'
      : startup.kind === 'custom'
        ? startup.command
        : startup.kind === 'shell'
          ? ''
          : AGENT_PRESETS[startup.kind].label
  return [card.title, card.worktree?.branch ?? '', agent].join('\n').toLowerCase()
}

/** Whether every space-separated term of `query` is in the card's searchable text, any case. */
export function matchesSearch(card: Card, query: string): boolean {
  const text = searchable(card)
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term))
}

/**
 * The grid's sections for `cards`, each latest first, holding only the cards that match `query`
 * and whose section `filter` shows.
 */
export function gridSections(
  cards: readonly Card[],
  state: { isRunning: (cardId: string) => boolean; isWaiting: (cardId: string) => boolean },
  query: string,
  filter: GridFilter
): GridSections {
  const sections: GridSections = { waiting: [], running: [], stopped: [] }
  for (const card of latestFirst(cards)) {
    if (!matchesSearch(card, query)) continue
    const section = !state.isRunning(card.id)
      ? 'stopped'
      : state.isWaiting(card.id)
        ? 'waiting'
        : 'running'
    if (filter === 'all' || filter === section) sections[section].push(card)
  }
  return sections
}
