import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  chmodSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync
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
 * are synchronous and arrive in order with `scrollback:quitSaved`, so those sent at quit are made
 * before main stops the shells.
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
      copyFileSync,
      utimesSync,
      renameSync,
      rmSync,
      readdirSync,
      linkSync
    }
  })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.on(IPC.transcriptsBackup, (event, cardId: unknown, folder: unknown, id: unknown) => {
    if (fromMainFrame(event)) backups.backup(cardId, folder, id)
  })
  ipcMain.on(IPC.transcriptsDelete, (event, cardId: unknown) => {
    if (fromMainFrame(event)) backups.delete(cardId)
  })
  // Before a resume (D11): the transcript there, put back from the backup, or missing.
  ipcMain.handle(
    IPC.transcriptsPrepare,
    (event, cardId: unknown, folder: unknown, id: unknown): ConversationPrepare =>
      fromMainFrame(event) ? backups.prepare(cardId, folder, id) : 'refused'
  )
  return backups
}
