/**
 * The renderer's answer to a `board` request (#9 D10): it resolves the card and column against
 * its store, applies the change, and answers with the reply the CLI prints. Plain TS.
 */
import type { Activity } from './activity'
import type { BoardCommand, SetupResult } from './board-args'
import {
  boardMoveTarget,
  cleanAgentStatus,
  findCallingWorkspace,
  noSetupError,
  notRunningError,
  resolveCard,
  resolveColumn
} from './board-commands'
import type { BoardReply } from './board-protocol'
import type { ClaudeUsage } from './claude-pricing'
import type { Card, WorkspaceStore } from './workspace-store'

/**
 * Applies `command` for the calling card (#9 D2, D7, D8). A move goes to the bottom of the
 * column through the store, so it is saved like any board change (#8 D6). `status` needs a
 * running card and hands the cleaned text to `setAgentStatus` (#9 D8), which shows it;
 * `activity` likewise hands its value to `setActivity`, null for `none` (#31 D12). `setup` acts
 * only on the calling card, which must be running with a pending setup (#39 D4): `ok` clears it in the store (saved) and hands the
 * card as it now is to `setupAnswered`, which types its start line; `failed` keeps it. `usage`
 * needs a running card and hands the usage to `setUsage`, which keeps it runtime only (#50 D5, D7).
 */
export function answerBoardCommand(
  store: Pick<WorkspaceStore, 'getState' | 'moveCard' | 'setAgentSession' | 'clearCardSetup'>,
  callingCardId: string,
  command: BoardCommand,
  isRunning: (cardId: string) => boolean,
  setAgentStatus: (cardId: string, text: string) => void,
  setActivity: (cardId: string, activity: Activity | null) => void = () => {},
  setupAnswered: (card: Card, result: SetupResult) => void = () => {},
  setUsage: (cardId: string, usage: ClaudeUsage) => void = () => {}
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
  if (command.command === 'session') {
    // Drovr's Claude hooks: the session this card resumes from now on (a message sent, a /resume).
    const set = store.setAgentSession(ws.id, card.value.id, command.session.toLowerCase())
    return set.ok ? { ok: true } : { ok: false, error: `board: ${set.error.message}` }
  }
  if (command.command === 'setup') {
    // Only the calling card's own setup (D4): another card's reads as having none.
    if (card.value.id !== callingCardId || !isRunning(card.value.id) || !card.value.setup) {
      return { ok: false, error: noSetupError(card.value) }
    }
    if (command.result === 'failed') {
      setupAnswered(card.value, 'failed')
      return { ok: true }
    }
    const cleared = store.clearCardSetup(ws.id, card.value.id)
    if (!cleared.ok) return { ok: false, error: `board: ${cleared.error.message}` }
    setupAnswered(cleared.value, 'ok')
    return { ok: true }
  }
  if (command.command === 'usage') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setUsage(card.value.id, command.usage)
    return { ok: true }
  }
  if (command.command === 'activity') {
    if (!isRunning(card.value.id)) return { ok: false, error: notRunningError(card.value) }
    setActivity(card.value.id, command.activity === 'none' ? null : command.activity)
    return { ok: true }
  }
  const column = resolveColumn(ws, command.column)
  if (!column.ok) return column
  const target = boardMoveTarget(ws, card.value, column.value.id)
  if (!target) return { ok: true }
  const moved = store.moveCard(ws.id, card.value.id, target.columnId, target.index)
  return moved.ok ? { ok: true } : { ok: false, error: `board: ${moved.error.message}` }
}
