import { app, ipcMain, type IpcMainEvent } from 'electron'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync
} from 'node:fs'
import { join } from 'node:path'
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
      readdirSync
    }
  })

  const fromMainFrame = (event: IpcMainEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.on(IPC.transcriptsBackup, (event, cardId: unknown, folder: unknown, id: unknown) => {
    if (fromMainFrame(event)) backups.backup(cardId, folder, id)
  })
  ipcMain.on(IPC.transcriptsDelete, (event, cardId: unknown) => {
    if (fromMainFrame(event)) backups.delete(cardId)
  })
  return backups
}
