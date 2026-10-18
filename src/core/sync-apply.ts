/**
 * Applying a board read from the sync folder to this machine's (#13 D6, D7, D8). Plain TS: the
 * renderer passes which cards run here, main passes none (its own state copy; the renderer then
 * applies the same board keeping its running cards). The active workspace is the store's business
 * (`replaceBoard`).
 */
import type { Card, Workspace } from './workspace-store'

/**
 * The board this machine takes from `incoming` (D7): the file's workspaces, columns, cards and
 * order, with this machine's `claudeStarted`, `startedAgents` (#21 D7) and pending setup (#39 D8) for local cards it
 * already has, else false and empty (D6), and every card running here (`isRunning`) kept (D8): a
 * running card the file lacks goes to the bottom of its column, or of its workspace's first column
 * when that column is gone; a workspace the file lacks that has a running card stays as this
 * machine has it, after the file's workspaces. A running card the file has takes the file's values.
 */
export function applySyncBoard(
  incoming: Workspace[],
  local: Workspace[],
  isRunning: (cardId: string) => boolean
): Workspace[] {
  const localStarted = new Map<string, Pick<Card, 'claudeStarted' | 'startedAgents' | 'setup'>>()
  for (const w of local)
    for (const c of w.cards)
      if (c.host === undefined)
        localStarted.set(c.id, {
          claudeStarted: c.claudeStarted,
          startedAgents: c.startedAgents,
          // A pending setup is this machine's (#39 D8): the file never has it.
          ...(c.setup !== undefined && { setup: c.setup })
        })
  const incomingCards = new Set(incoming.flatMap((w) => w.cards.map((c) => c.id)))
  const incomingIds = new Set(incoming.map((w) => w.id))
  const localById = new Map(local.map((w) => [w.id, w]))
  /** Cards running here that the file lacks. */
  const kept = (w: Workspace): Card[] =>
    w.cards.filter((c) => isRunning(c.id) && !incomingCards.has(c.id))

  const applied = incoming.map((w) => {
    const cards = w.cards.map((c) =>
      c.host === undefined
        ? { ...c, ...(localStarted.get(c.id) ?? { claudeStarted: false, startedAgents: [] }) }
        : c
    )
    const mine = localById.get(w.id)
    const first = w.columns[0]
    if (mine && first) {
      for (const c of kept(mine)) {
        const columnId = w.columns.some((col) => col.id === c.columnId) ? c.columnId : first.id
        cards.push(columnId === c.columnId ? c : { ...c, columnId })
      }
    }
    return { ...w, cards }
  })
  // A workspace the file deleted stays whole while a card of it runs here; a card the file has
  // elsewhere is left out, so ids stay unique (#8 D3).
  const stays = local
    .filter((w) => !incomingIds.has(w.id) && kept(w).length > 0)
    .map((w) => ({ ...w, cards: w.cards.filter((c) => !incomingCards.has(c.id)) }))
  return [...applied, ...stays]
}
