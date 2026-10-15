import { answerBoardCommand } from '../../core/board-answer'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * Answers `board` requests from cards' shells (#9 D10): resolved and applied against the store,
 * so a move shows at once on the board and in the sidebar and is saved like any change; a
 * status shows on the card's status line, and an activity as its pill, until cleared or the card
 * stops (#9 D8, #31 D12).
 */
export function listenForBoardRequests(): () => void {
  return window.drovr.board.onRequest((cardId, command) =>
    answerBoardCommand(
      workspaceStore,
      cardId,
      command,
      (id) => cardTerminals().runState(id)?.kind === 'running',
      (id, text) => cardTerminals().setAgentStatus(id, text),
      (id, activity) => cardTerminals().setActivity(id, activity)
    )
  )
}
