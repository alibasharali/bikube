import { transcriptBackupTarget } from '../../core/transcript-backup-target'
import { cardTerminals, onQuitSave } from './card-terminals'
import { workspaceStore } from './store'

/**
 * Asks main to back up the card's current Claude Code conversation (#80 D8, D9) when it is a
 * local Claude Code card on the board; main copies only what changed since the last copy.
 */
export function backupTranscript(cardId: string): void {
  for (const workspace of workspaceStore.getState().workspaces) {
    const card = workspace.cards.find((c) => c.id === cardId)
    if (!card) continue
    const target = transcriptBackupTarget(card)
    if (target) window.bikube.transcripts.backup(card.id, target.folder, target.sessionId)
    return
  }
}

/**
 * Backs up a card's transcript when its main pane stops (exit, Close) and every running card's
 * as the app starts quitting, before main stops the shells (#80 D9). `board usage` backs up too
 * (`listenForBoardRequests`).
 */
export function startTranscriptBackups(): void {
  const terminals = cardTerminals()
  terminals.onEnded(backupTranscript)
  onQuitSave(() => {
    for (const workspace of workspaceStore.getState().workspaces) {
      for (const card of workspace.cards) {
        if (terminals.runState(card.id)?.kind === 'running') backupTranscript(card.id)
      }
    }
  })
}
