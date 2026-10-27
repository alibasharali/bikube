import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { readAgentSetup } from '../core/agent-setup-reader'
import type { AgentSetupRead } from '../core/agent-setup-snapshot'
import { isDirectory } from '../core/directories'
import { IPC } from '../shared/api'

/** Each folder's running read, shared by requests made during it (#68 D26: never two at once). */
const reading = new Map<string, Promise<AgentSetupRead>>()

/**
 * The files each folder's last read found (D28): Open file and Reveal (S6) accept only these.
 */
const listed = new Map<string, ReadonlySet<string>>()

/** Whether the last read of workspace folder `folder` listed `path`. */
export function agentSetupListed(folder: string, path: string): boolean {
  return listed.get(folder)?.has(path) === true
}

/**
 * The Agent setup page's reads (#68 D8, D26, D28): `agentSetup:read` reads a workspace folder's
 * Claude Code setup with the user's home (`BIKUBE_HOME_DIR`, else the OS home, as sync does).
 * Requests come from the main frame only and must name an absolute, existing directory; nothing a
 * file names is run.
 */
export function registerAgentSetup(): void {
  ipcMain.handle(IPC.agentSetupRead, async (event, folder: unknown): Promise<AgentSetupRead> => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
      throw new Error(`${IPC.agentSetupRead} rejected: untrusted sender`)
    }
    if (typeof folder !== 'string' || !(await isDirectory(folder))) {
      return { ok: false, reason: 'not-directory' }
    }
    let read = reading.get(folder)
    if (!read) {
      const home = process.env['BIKUBE_HOME_DIR'] || homedir()
      read = readAgentSetup({ folder, home })
        .then((snapshot): AgentSetupRead => {
          listed.set(folder, new Set(snapshot.paths))
          return { ok: true, snapshot }
        })
        .finally(() => reading.delete(folder))
      reading.set(folder, read)
    }
    return read
  })
}
