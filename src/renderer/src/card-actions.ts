import { keyMoveTarget, type CardMoveDirection } from '../../core/card-moves'
import type { Workspace, Card } from '../../core/workspace-store'
import type { FirstStart } from '../../core/startup-command'
import { isOrchestratorId, orchestratorId } from '../../core/orchestrator'
import { shellCards } from '../../core/workspace-shells'
import { forgetSendMarks } from './board-send-wait'
import { cardPanes, cardTerminals } from './card-terminals'
import { forgetConversationCheck, startCheckingConversation } from './conversation-checks'
import { findTerminal, rememberOrchestratorStart } from './orchestrator'
import { forgetPendingWorktree, makePendingWorktree } from './pending-worktrees'
import { settingsStore } from './settings'
import { workspaceStore } from './store'
import { clearShellAgent } from './shell-agents'
import { clearCardUsage } from './usage'

/**
 * Starts the card if its shell isn't running, with its current startup command (#5 D7, D8);
 * a running card is left as it is. Opening a card, and creating one, goes through here, so a
 * card with a pending worktree (#69 D10) gets it made first, and a resuming Claude Code card its
 * conversation checked (#80 D11), by whichever path opens it.
 */
export function startCard(workspaceId: string, cardId: string): void {
  // The Orchestrator gets its conversation at its first start (#81 D8).
  if (isOrchestratorId(cardId) && cardTerminals().runState(cardId)?.kind !== 'running') {
    workspaceStore.ensureOrchestrator(workspaceId)
  }
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  // A shell starts like a card: in the folder it runs in; so does the Orchestrator, with
  // Settings' Orchestrator agent.
  const card = workspace && findTerminal(workspace, cardId)
  if (!card) return
  // A local Claude Code card resuming gets its conversation checked first (#80 D11); a running
  // card types no resume line, so it is never checked.
  const start = (starting: Card): void => {
    const launch = (checked: Card): void => {
      // A running Orchestrator keeps the agent it starts with now (#81 D7).
      if (
        isOrchestratorId(checked.id) &&
        cardTerminals().runState(checked.id)?.kind !== 'running'
      ) {
        rememberOrchestratorStart(checked.id, checked.startup)
      }
      cardTerminals().start(checked, recordFirstStart(workspaceId, cardId))
    }
    if (cardTerminals().runState(starting.id)?.kind === 'running') launch(starting)
    else startCheckingConversation(workspaceId, starting, launch)
  }
  if (
    card.pendingWorktree &&
    card.host === undefined &&
    !card.worktree &&
    cardTerminals().runState(cardId)?.kind !== 'running'
  ) {
    makePendingWorktree(workspaceId, card, start)
    return
  }
  // A failed first open is over once the card has a worktree (moved or synced) or lost its
  // pending one: the view must not keep its error and Retry.
  if (!card.pendingWorktree || card.worktree) forgetPendingWorktree(cardId)
  start(card)
}

/**
 * Run in workspace folder (#69 D10): drops the card's pending worktree (saved and synced) and
 * starts it in the workspace folder.
 */
export function runPendingInWorkspaceFolder(workspaceId: string, cardId: string): void {
  workspaceStore.clearPendingWorktree(workspaceId, cardId)
  startCard(workspaceId, cardId)
  forgetPendingWorktree(cardId)
}

/**
 * Start a new conversation (#80 D12): the card's conversation is gone, so it starts its session id
 * fresh, typing the first-start line (with #69's first prompt when it has a description).
 */
export function startNewConversation(workspaceId: string, cardId: string): void {
  workspaceStore.clearClaudeStarted(workspaceId, cardId)
  forgetConversationCheck(cardId)
  startCard(workspaceId, cardId)
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
 * its kept output (#46 D7; a shell has none, and removing none does nothing), its transcript
 * backup (#80 D10), its usage (#50 D7) and `board send` marks (#81 D20), or a shell's Claude Code session and usage (#75 D3a).
 */
export function disposeCard(cardId: string): void {
  cardPanes().dispose(cardId)
  cardTerminals().dispose(cardId)
  window.bikube.scrollback.delete(cardId)
  window.bikube.transcripts.delete(cardId)
  clearCardUsage(cardId)
  clearShellAgent(cardId)
  forgetSendMarks(cardId)
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
  disposeCard(orchestratorId(workspace.id))
  workspaceStore.deleteWorkspace(workspace.id)
}

/**
 * New conversation (#81 D11): the Orchestrator stops if it runs (as Close does), gets a new
 * session id with nothing started and loses its kept output, then `open` opens and starts it.
 */
export function newOrchestratorConversation(
  workspaceId: string,
  open: (cardId: string) => void
): void {
  const id = orchestratorId(workspaceId)
  const fresh = (): void => {
    if (!workspaceStore.newOrchestratorConversation(workspaceId).ok) return
    // After the stop's own save of its output, which goes first (#46 D2).
    window.bikube.scrollback.delete(id)
    forgetConversationCheck(id)
    open(id)
  }
  if (cardTerminals().runState(id)?.kind !== 'running') {
    fresh()
    return
  }
  const stop = cardTerminals().subscribe(id, () => {
    if (cardTerminals().runState(id)?.kind === 'running') return
    stop()
    setTimeout(fresh, 0)
  })
  closeCard(id)
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
