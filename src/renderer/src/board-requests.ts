import { answerBoardCommand } from '../../core/board-answer'
import { continueAfterSetup } from './card-actions'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'
import { setCardUsage } from './usage'

/**
 * Answers `board` requests from cards' shells (#9 D10): resolved and applied against the store,
 * so a move shows at once on the board and in the sidebar and is saved like any change; a
 * status shows on the card's status line, and an activity as its pill, until cleared or the card
 * stops (#9 D8, #31 D12). A setup's `ok` types the card's start line, its `failed` shows on the
 * card (#39 D4, D5). A usage is kept for the card's usage line, runtime only (#50 D7).
 */
export function listenForBoardRequests(): () => void {
  return window.drovr.board.onRequest((cardId, command) =>
    answerBoardCommand(
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
      setCardUsage
    )
  )
}
