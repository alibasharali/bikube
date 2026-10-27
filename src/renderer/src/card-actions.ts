import { keyMoveTarget, type CardMoveDirection } from '../../core/card-moves'
import type { Workspace, Card } from '../../core/workspace-store'
import type { FirstStart } from '../../core/startup-command'
import { findShellCard, shellCards } from '../../core/workspace-shells'
import { cardPanes, cardTerminals } from './card-terminals'
import { settingsStore } from './settings'
import { workspaceStore } from './store'
import { clearCardUsage } from './usage'

/**
 * Starts the card if its shell isn't running, with its current startup command (#5 D7, D8);
 * a running card is left as it is. Opening a card, and creating one, goes through here.
 */
export function startCard(workspaceId: string, cardId: string): void {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  // A shell (the Default one included) starts like a card: in the workspace's folder.
  const card =
    workspace?.cards.find((c) => c.id === cardId) ?? (workspace && findShellCard(workspace, cardId))
  if (!card) return
  cardTerminals().start(card, recordFirstStart(workspaceId, cardId))
}

/**
 * Records that a board card was opened now, so the grid view shows it first, and clears its New
 * mark (#69 D11); shells aren't.
 */
export function markCardOpened(workspaceId: string, cardId: string): void {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (workspace?.cards.some((c) => c.id === cardId)) {
    workspaceStore.markCardOpened(workspaceId, cardId, Date.now())
  }
}

/** Records a first start of Claude Code or a preset on the card (#5 D5, #21 D3). */
function recordFirstStart(workspaceId: string, cardId: string): (kind: FirstStart) => void {
  return (kind) => {
    if (kind === 'claude') workspaceStore.markClaudeStarted(workspaceId, cardId)
    else workspaceStore.markAgentStarted(workspaceId, cardId, kind)
  }
}

/**
 * The card's setup succeeded or was skipped, its pending setup already cleared in the store (#39
 * D4, D6): its start line is typed into the main pane as a start would type it.
 */
export function continueAfterSetup(workspaceId: string, card: Card): void {
  cardTerminals().continueAfterSetup(card, recordFirstStart(workspaceId, card.id))
}

/** Retry setup (#39 D6): types the card's pending setup line again; it is `Setting up` again. */
export function retrySetup(workspaceId: string, cardId: string): void {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  const setup = workspace?.cards.find((c) => c.id === cardId)?.setup
  if (setup) cardTerminals().typeSetup(cardId, setup)
}

/** Skip setup (#39 D6): clears the card's pending setup (saved), then types its start line. */
export function skipSetup(workspaceId: string, cardId: string): void {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  // A stale Skip, its setup already answered, types nothing.
  if (!workspace?.cards.find((c) => c.id === cardId)?.setup) return
  const cleared = workspaceStore.clearCardSetup(workspaceId, cardId)
  if (cleared.ok) continueAfterSetup(workspaceId, cleared.value)
}

/**
 * Closes a running card (#7 D1, D2): stops its process and keeps the card where it is; it turns
 * Stopped when its shell has exited. Anything else is left as it is.
 */
export function closeCard(cardId: string): void {
  cardTerminals().close(cardId)
}

/**
 * Close from the card's menu, its button or a shortcut: `ask` opens the Close confirmation, or
 * the card closes at once when the user chose Don't ask again.
 */
export function requestCloseCard(cardId: string, ask: () => void): void {
  if (settingsStore.get().confirmClose) ask()
  else closeCard(cardId)
}

/**
 * Stops every pane's process of a card being deleted and frees its screens (#11 D6), and removes
 * its kept output (#46 D7; a shell has none, and removing none does nothing) and its usage
 * (#50 D7).
 */
export function disposeCard(cardId: string): void {
  cardPanes().dispose(cardId)
  cardTerminals().dispose(cardId)
  window.bikube.scrollback.delete(cardId)
  clearCardUsage(cardId)
}

/** Deletes a card and stops its processes, freeing its terminals (#4 D13, #11 D6). */
export function removeCard(workspaceId: string, cardId: string): void {
  disposeCard(cardId)
  workspaceStore.deleteCard(workspaceId, cardId)
}

/**
 * Deletes a card with its own worktree, removing the worktree too when asked (`force` with
 * uncommitted changes); its branch stays. The card goes at once; the worktree follows.
 */
export function removeWorktreeCard(
  workspaceId: string,
  card: Card,
  removeWorktree: boolean,
  force: boolean
): void {
  removeCard(workspaceId, card.id)
  if (!removeWorktree || !card.worktree) return
  const { repo, path } = card.worktree
  void window.bikube.worktree.remove(repo, path, force).then((result) => {
    if (!result.ok) console.error(`worktree not removed (${path}): ${result.reason}`)
  })
}

/** Deletes a shell, stopping its processes. */
export function removeShell(workspaceId: string, shellId: string): void {
  disposeCard(shellId)
  workspaceStore.deleteShell(workspaceId, shellId)
}

/**
 * Restarts a shell (or card): a running one is closed, then started again once it has stopped,
 * so a dev server's command runs anew; a stopped one just starts.
 */
export function restartCard(workspaceId: string, cardId: string): void {
  if (cardTerminals().runState(cardId)?.kind !== 'running') {
    startCard(workspaceId, cardId)
    return
  }
  const stop = cardTerminals().subscribe(cardId, () => {
    if (cardTerminals().runState(cardId)?.kind === 'running') return
    stop()
    startCard(workspaceId, cardId)
  })
  closeCard(cardId)
}

/** Deletes a workspace and stops every one of its cards' and shells' processes (#4 D15, #11 D6). */
export function removeWorkspace(workspace: Workspace): void {
  workspace.cards.forEach((card) => disposeCard(card.id))
  shellCards(workspace).forEach((shell) => disposeCard(shell.id))
  workspaceStore.deleteWorkspace(workspace.id)
}

/** The card whose open button takes focus at its next render, after a keyboard or menu move. */
let focusAfterMove: string | null = null

/**
 * Moves a card one step with the keyboard (#6 D7); at an end nothing happens. Returns whether
 * it moved; the moved card then takes focus back (see `takeFocusAfterMove`).
 */
export function moveCardByKey(
  workspaceId: string,
  cardId: string,
  direction: CardMoveDirection
): boolean {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  const target = workspace && keyMoveTarget(workspace, cardId, direction)
  if (!target) return false
  focusAfterMove = cardId
  const moved = workspaceStore.moveCard(workspaceId, cardId, target.columnId, target.index).ok
  if (!moved) focusAfterMove = null
  return moved
}

/**
 * Moves a card to the bottom of another column from its menu (#6 D8). The card remounts
 * there and takes focus back (see `takeFocusAfterMove`).
 */
export function moveCardToColumn(workspaceId: string, cardId: string, columnId: string): boolean {
  focusAfterMove = cardId
  const moved = workspaceStore.moveCard(workspaceId, cardId, columnId, Number.POSITIVE_INFINITY).ok
  if (!moved) focusAfterMove = null
  return moved
}

/** The card just moved by keyboard or menu that hasn't taken focus back yet, or null. */
export function movedCard(): string | null {
  return focusAfterMove
}

/** True once for the card that was just moved by keyboard or menu, so it can refocus itself. */
export function takeFocusAfterMove(cardId: string): boolean {
  if (focusAfterMove !== cardId) return false
  focusAfterMove = null
  return true
}
