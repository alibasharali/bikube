import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AgentSummaryRead } from '../core/agent-tab'
import {
  SessionLookup,
  TranscriptTailer,
  readAgentSummary,
  readSessionSummary
} from '../core/agent-transcript'
import { IPC } from '../shared/api'
import { userHome } from './home'

const fromMainFrame = (event: IpcMainInvokeEvent, channel: string): void => {
  if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${channel} rejected: untrusted sender`)
  }
}

/**
 * Where the development build counts the summary requests main receives, by session id, for the
 * smoke tests (#75 AC14).
 */
const TEST_HOOK = '__bikubeAgentTabRequests'

/**
 * The Agent tab's request (#75 D3, D4, D5): main frame only; the folder and session id are checked
 * by `readAgentSummary`, which reads nothing but the session's transcript under the user's home
 * (`BIKUBE_HOME_DIR`, else the OS home), tailed by one `TranscriptTailer` for the app's run. A
 * workspace shell's request names the session alone, its transcript found by `readSessionSummary`
 * in any one project folder, the path kept by one `SessionLookup` (D3a).
 */
export function registerAgentTab(): void {
  const tailer = new TranscriptTailer()
  const lookup = new SessionLookup()
  const counts: Record<string, number> = {}
  if (!app.isPackaged) Object.assign(globalThis, { [TEST_HOOK]: counts })
  const count = (sessionId: unknown): void => {
    if (!app.isPackaged && typeof sessionId === 'string') {
      counts[sessionId] = (counts[sessionId] ?? 0) + 1
    }
  }
  ipcMain.handle(
    IPC.agentTabSummary,
    (event, folder: unknown, sessionId: unknown, since: unknown): Promise<AgentSummaryRead> => {
      fromMainFrame(event, IPC.agentTabSummary)
      count(sessionId)
      return readAgentSummary({ folder, sessionId, since }, { home: userHome(), tailer })
    }
  )
  ipcMain.handle(
    IPC.agentTabSessionSummary,
    (event, sessionId: unknown, since: unknown): Promise<AgentSummaryRead> => {
      fromMainFrame(event, IPC.agentTabSessionSummary)
      count(sessionId)
      return readSessionSummary({ sessionId, since }, { home: userHome(), lookup, tailer })
    }
  )
}
