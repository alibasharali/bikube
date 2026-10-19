/**
 * Each workspace's view for this run of the app (#31 D19): the card open at full size in it, or
 * none for its board. Runtime only: never saved or synced, so after a restart every workspace
 * shows its board.
 */
export type ViewMemory = Readonly<Record<string, string>>

/** Every workspace on its board. */
export const NO_VIEWS: ViewMemory = Object.freeze({})

/** The card remembered open in `workspaceId`, or null for its board. */
export function openedCard(views: ViewMemory, workspaceId: string): string | null {
  return Object.hasOwn(views, workspaceId) ? views[workspaceId] : null
}

/** Opening a card on a board replaces that workspace's remembered card. */
export function rememberCard(views: ViewMemory, workspaceId: string, cardId: string): ViewMemory {
  return { ...views, [workspaceId]: cardId }
}

/** The workspace goes back to its board: Back, or its open card stopped. */
export function forgetView(views: ViewMemory, workspaceId: string): ViewMemory {
  if (!Object.hasOwn(views, workspaceId)) return views
  const next = { ...views }
  delete next[workspaceId]
  return next
}

/**
 * The cards in `cardIds` went to their own windows (#53 D6): each workspace that had one of them
 * open goes to its board and forgets it.
 */
export function forgetCards(views: ViewMemory, cardIds: readonly string[]): ViewMemory {
  let next = views
  for (const [workspaceId, cardId] of Object.entries(views)) {
    if (cardIds.includes(cardId)) next = forgetView(next, workspaceId)
  }
  return next
}

/**
 * Selecting `targetId` while `activeId` is active (sidebar or Mod+digit): another workspace keeps
 * its view; the active one goes to its board and forgets its card.
 */
export function selectWorkspace(
  views: ViewMemory,
  activeId: string | null,
  targetId: string
): ViewMemory {
  return targetId === activeId ? forgetView(views, targetId) : views
}

/**
 * The views once `workspaceId` becomes active, however that happened: its remembered card is
 * kept only while it is still one of `cardIds` (null when the workspace is gone) and running, so
 * a workspace never comes back to a Stopped or missing card.
 */
export function enterWorkspace(
  views: ViewMemory,
  workspaceId: string,
  cardIds: readonly string[] | null,
  isRunning: (cardId: string) => boolean
): ViewMemory {
  const cardId = openedCard(views, workspaceId)
  if (cardId === null) return views
  if (cardIds?.includes(cardId) && isRunning(cardId)) return views
  return forgetView(views, workspaceId)
}
