import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { editorShell } from '../core/editor'
import { readInstalledAgents, type AgentChoice } from '../core/installed-agents'
import { IPC } from '../shared/api'

/**
 * Which agent CLIs are installed (`agents:installed`), read through the login shell the Shell
 * setting `shellSetting()` names (else `$SHELL`), as the editor and `gh` run. Requests come from
 * the main frame only; one check runs at a time, a request during it sharing its answer.
 */
export function registerAgents(shellSetting: () => string): void {
  let running: Promise<AgentChoice[] | null> | null = null
  ipcMain.handle(IPC.agentsInstalled, (event): Promise<AgentChoice[] | null> => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
      throw new Error(`${IPC.agentsInstalled} rejected: untrusted sender`)
    }
    running ??= readInstalledAgents({
      spawn,
      shell: editorShell(shellSetting(), process.env),
      env: process.env
    }).finally(() => {
      running = null
    })
    return running
  })
}
