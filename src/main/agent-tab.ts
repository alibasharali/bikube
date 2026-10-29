import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AgentSummaryRead } from '../core/agent-tab'
import { readAgentSummary } from '../core/agent-transcript'
import { IPC } from '../shared/api'
import { userHome } from './home'

const fromMainFrame = (event: IpcMainInvokeEvent, channel: string): void => {
  if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${channel} rejected: untrusted sender`)
  }
}

/**
 * The Agent tab's request (#75 D3, D4): main frame only; the folder and session id are checked
 * by `readAgentSummary`, which reads nothing but the session's transcript under the user's home
 * (`BIKUBE_HOME_DIR`, else the OS home).
 */
export function registerAgentTab(): void {
  ipcMain.handle(
    IPC.agentTabSummary,
    (event, folder: unknown, sessionId: unknown): Promise<AgentSummaryRead> => {
      fromMainFrame(event, IPC.agentTabSummary)
      return readAgentSummary({ folder, sessionId }, { home: userHome() })
    }
  )
}
