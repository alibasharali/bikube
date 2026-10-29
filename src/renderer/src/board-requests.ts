import { answerBoardCommand, checkCreateWorktree } from '../../core/board-answer'
import { findShellCard } from '../../core/workspace-shells'
import { continueAfterSetup } from './card-actions'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/** Whether `id` is one of the workspaces' shells (the Default one included), not a card. */
const isWorkspaceShell = (id: string): boolean =>
  workspaceStore.getState().workspaces.some((w) => findShellCard(w, id) !== undefined)
import { clearShellAgent, setShellSession, setShellUsage } from './shell-agents'
import { setCardUsage } from './usage'

/**
 * Answers `board` requests from cards' shells (#9 D10): resolved and applied against the store,
 * so a move shows at once on the board and in the sidebar and is saved like any change; a
 * status shows on the card's status line, and an activity as its pill, until cleared or the card
 * stops (#9 D8, #31 D12). A setup's `ok` types the card's start line, its `failed` shows on the
 * card (#39 D4, D5). A usage is kept for the card's usage line, runtime only (#50 D7).
 * A create with `--worktree` asks main for the repository's branches first (#69 D10).
 * A workspace shell's own session and usage are kept for the Agent tab, runtime only, and
 * forgotten each time it stops (#75 D3a).
 */
export function listenForBoardRequests(): () => void {
  cardTerminals().onEnded(clearShellAgent)
  return window.bikube.board.onRequest(async (cardId, request) => {
    const checked = await checkCreateWorktree(
      workspaceStore.getState(),
      cardId,
      request,
      window.bikube.worktree.info
    )
    if (!checked.ok) return checked
    const command = checked.command
    return answerBoardCommand(
      workspaceStore,
      cardId,
      command,
      (id) => cardTerminals().runState(id)?.kind === 'running',
      (id, text) => cardTerminals().setAgentStatus(id, text),
      (id, activity) => cardTerminals().setActivity(id, activity),
      (card, result) => {
        if (result === 'failed') {
          cardTerminals().setupFailed(card.id)
          return
        }
        const workspace = workspaceStore
          .getState()
          .workspaces.find((w) => w.cards.some((c) => c.id === card.id))
        if (workspace) continueAfterSetup(workspace.id, card)
      },
      (id, usage) => {
        if (isWorkspaceShell(id)) setShellUsage(id, usage)
        else setCardUsage(id, usage)
      },
      (id) => {
        const running = cardTerminals().runState(id)?.kind === 'running'
        const status = cardTerminals().status(id)
        return { running, activity: status?.activity, status: status?.agentStatus }
      },
      setShellSession
    )
  })
}
