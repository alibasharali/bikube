import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { SettingsWriteResult } from '../core/agent-setup-snapshot'
import { readClaudeRetention, setClaudeRetention } from '../core/claude-retention'
import type { ClaudeRetention } from '../core/claude-retention-types'
import { IPC } from '../shared/api'
import { userHome } from './home'

const fromMainFrame = (event: IpcMainInvokeEvent, channel: string): void => {
  if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${channel} rejected: untrusted sender`)
  }
}

/**
 * Claude Code's conversation retention (#80 D2–D4): `claudeRetention:read` reads
 * `cleanupPeriodDays` from `<home>/.claude/settings.json` (`BIKUBE_HOME_DIR`, else the OS home),
 * and `claudeRetention:set` raises it to 3650 there, one write at a time, re-reading the file
 * first. The renderer names neither the file nor the value. Main frame only.
 */
export function registerClaudeRetention(): void {
  let writing: Promise<SettingsWriteResult> = Promise.resolve({ ok: true })

  ipcMain.handle(IPC.claudeRetentionRead, (event): Promise<ClaudeRetention> => {
    fromMainFrame(event, IPC.claudeRetentionRead)
    return readClaudeRetention(userHome())
  })

  ipcMain.handle(IPC.claudeRetentionSet, (event): Promise<SettingsWriteResult> => {
    fromMainFrame(event, IPC.claudeRetentionSet)
    writing = writing.catch(() => undefined).then(() => setClaudeRetention(userHome()))
    return writing
  })
}
