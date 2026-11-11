import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  chmodSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  promises,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import type { ConversationPrepare } from '../core/claude-retention-types'
import { TranscriptBackups } from '../core/transcript-backups'
import { IPC } from '../shared/api'
import { userHome } from './home'

/**
 * Local Claude Code cards' transcript backups (#80 D8–D10) in `<userData>/transcripts`: only the
 * window's own top-level page may back up or delete, as with `scrollback:*`. The renderer names a
 * card id, its folder and its session id; the store checks them before reading anything. Copies
 * run with async fs, one at a time per card, so a long session's copy never stalls PTY forwarding;
 * those sent at quit arrive before `scrollback:quitSaved`, and main awaits `idle()` after it
 * before stopping the shells (`src/main/index.ts`).
 */
export function registerTranscripts(): TranscriptBackups {
  const backups = new TranscriptBackups({
    dir: join(app.getPath('userData'), 'transcripts'),
    home: userHome,
    fs: {
      mkdirSync,
      chmodSync,
      statSync,
      lstatSync,
      realpathSync,
      copyFileSync,
      renameSync,
      rmSync,
      readdirSync,
      linkSync,
      promises
    }
  })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.on(IPC.transcriptsBackup, (event, cardId: unknown, folder: unknown, id: unknown) => {
    if (fromMainFrame(event)) void backups.backup(cardId, folder, id)
  })
  ipcMain.on(IPC.transcriptsDelete, (event, cardId: unknown) => {
    if (fromMainFrame(event)) void backups.delete(cardId)
  })
  // Before a resume (D11): the transcript there, put back from the backup, or missing.
  ipcMain.handle(
    IPC.transcriptsPrepare,
    (event, cardId: unknown, folder: unknown, id: unknown): Promise<ConversationPrepare> =>
      fromMainFrame(event) ? backups.prepare(cardId, folder, id) : Promise.resolve('refused')
  )
  return backups
}
