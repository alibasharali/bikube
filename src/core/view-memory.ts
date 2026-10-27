/**
 * Each workspace's view for this run of the app (#31 D19): the card open at full size in it, its
 * Agent setup page (#68 D3), or none for its board. Runtime only: never saved or synced, so after
 * a restart every workspace shows its board.
 */
export type WorkspaceViewEntry = { kind: 'card'; cardId: string } | { kind: 'agentSetup' }

export type ViewMemory = Readonly<Record<string, WorkspaceViewEntry>>

/** Every workspace on its board. */
export const NO_VIEWS: ViewMemory = Object.freeze({})

/** The card remembered open in `workspaceId`, or null for its board or Agent setup. */
export function openedCard(views: ViewMemory, workspaceId: string): string | null {
  if (!Object.hasOwn(views, workspaceId)) return null
  const view = views[workspaceId]
  return view.kind === 'card' ? view.cardId : null
}

/** Whether `workspaceId`'s view is its Agent setup page (#68 D3). */
export function showsAgentSetup(views: ViewMemory, workspaceId: string): boolean {
  return Object.hasOwn(views, workspaceId) && views[workspaceId].kind === 'agentSetup'
}

/** The workspaces whose view is Agent setup, each listing its row in the sidebar tree (D3). */
export function agentSetupWorkspaces(views: ViewMemory): string[] {
  return Object.keys(views).filter((id) => views[id].kind === 'agentSetup')
}

/** Opening a card on a board replaces that workspace's remembered card or Agent setup. */
export function rememberCard(views: ViewMemory, workspaceId: string, cardId: string): ViewMemory {
  return { ...views, [workspaceId]: { kind: 'card', cardId } }
}

/** Opening Agent setup replaces that workspace's remembered card, as opening a card would (D2). */
export function rememberAgentSetup(views: ViewMemory, workspaceId: string): ViewMemory {
  return { ...views, [workspaceId]: { kind: 'agentSetup' } }
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
  for (const workspaceId of Object.keys(views)) {
    const cardId = openedCard(views, workspaceId)
    if (cardId !== null && cardIds.includes(cardId)) next = forgetView(next, workspaceId)
  }
  return next
}

/**
 * Selecting `targetId` while `activeId` is active (sidebar or Mod+digit): another workspace keeps
 * its view; the active one goes to its board and forgets its card or Agent setup.
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
 * a workspace never comes back to a Stopped or missing card. Agent setup is kept while the
 * workspace exists.
 */
export function enterWorkspace(
  views: ViewMemory,
  workspaceId: string,
  cardIds: readonly string[] | null,
  isRunning: (cardId: string) => boolean
): ViewMemory {
  if (!Object.hasOwn(views, workspaceId)) return views
  if (showsAgentSetup(views, workspaceId)) {
    return cardIds === null ? forgetView(views, workspaceId) : views
  }
  const cardId = openedCard(views, workspaceId)
  if (cardId !== null && cardIds?.includes(cardId) && isRunning(cardId)) return views
  return forgetView(views, workspaceId)
}
