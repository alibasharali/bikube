import { answerBoardCommand } from '../../core/board-answer'
import { cardTerminals } from './card-terminals'
import { workspaceStore } from './store'

/**
 * Answers `board` requests from cards' shells (#9 D10): resolved and applied against the store,
 * so a move shows at once on the board and in the sidebar and is saved like any change.
 */
export function listenForBoardRequests(): () => void {
  return window.drovr.board.onRequest((cardId, command) =>
    answerBoardCommand(
      workspaceStore,
      cardId,
      command,
      (id) => cardTerminals().runState(id)?.kind === 'running'
    )
  )
}
