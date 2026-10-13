/**
 * The renderer's answer to a `board` request (#9 D10): it resolves the card and column against
 * its store, applies the change, and answers with the reply the CLI prints. Plain TS.
 */
import type { BoardCommand } from './board-args'
import {
  boardMoveTarget,
  cleanAgentStatus,
  findCallingWorkspace,
  notRunningError,
  resolveCard,
  resolveColumn
} from './board-commands'
import type { BoardReply } from './board-protocol'
import type { WorkspaceStore } from './workspace-store'

/**
 * Applies `command` for the calling card (#9 D2, D7, D8). A move goes to the bottom of the
 * column through the store, so it is saved like any board change (#8 D6). `status` needs a
 * running card and hands the cleaned text to `setAgentStatus` (#9 D8), which shows it.
 */
export function answerBoardCommand(
  store: Pick<WorkspaceStore, 'getState' | 'moveCard'>,
  callingCardId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  setAgentStatus: (cardId: string, text: string) => void
): BoardReply {
  const workspace = findCallingWorkspace(store.getState(), callingCardId)
  if (!workspace.ok) return workspace
  const ws = workspace.value
  const card = resolveCard(ws, callingCardId, command.card)
  if (!card.ok) return card
  if (command.command === 'status') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setAgentStatus(card.value.id, cleanAgentStatus(command.text))
    return { ok: true }
  }
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  const target = boardMoveTarget(ws, card.value, column.value.id)
  if (!target) return { ok: true }
  const moved = store.moveCard(ws.id, card.value.id, target.columnId, target.index)
  return moved.ok ? { ok: true } : { ok: false, error: `board: ${moved.error.message}` }
}
