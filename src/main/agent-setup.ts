import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { readAgentSetup } from '../core/agent-setup-reader'
import type { AgentSetupRead, SettingsWriteResult } from '../core/agent-setup-snapshot'
import { agentSetupWrite, parseSwitchRequest } from '../core/agent-setup-writes'
import { readClaudeVersion, type ClaudeVersion } from '../core/claude-version'
import { isDirectory } from '../core/directories'
import { editorShell } from '../core/editor'
import { IPC } from '../shared/api'
import { claudeSettingsPath } from './board'

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

/** Each folder's last write, the next one queued behind it (D23: every write re-reads the file). */
const writing = new Map<string, Promise<SettingsWriteResult>>()

const userHome = (): string => process.env['BIKUBE_HOME_DIR'] || homedir()

const fromMainFrame = (event: IpcMainInvokeEvent, channel: string): void => {
  if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${channel} rejected: untrusted sender`)
  }
}

/**
 * The Agent setup page's reads (#68 D8, D13, D26, D28): `agentSetup:read` reads a workspace
 * folder's Claude Code setup with the user's home (`BIKUBE_HOME_DIR`, else the OS home, as sync
 * does) and Bikube's own Claude Code settings file; `agentSetup:claudeVersion` runs
 * `claude --version` through the login shell the Shell setting `shellSetting()` names (else
 * `$SHELL`), as the installed-agents check does, one at a time; `agentSetup:switch` turns a
 * plugin or a project MCP server on or off in `<folder>/.claude/settings.local.json` (D23), only for
 * a plugin key `installed_plugins.json` lists or a server name `.mcp.json` lists, one write at a
 * time per folder. Requests come from the main frame only and must name an absolute, existing
 * directory; nothing a file names is run.
 */
export function registerAgentSetup(shellSetting: () => string): void {
  let version: Promise<ClaudeVersion | null> | null = null
  ipcMain.handle(IPC.agentSetupClaudeVersion, (event): Promise<ClaudeVersion | null> => {
    fromMainFrame(event, IPC.agentSetupClaudeVersion)
    version ??= readClaudeVersion({
      spawn,
      shell: editorShell(shellSetting(), process.env),
      env: process.env
    }).finally(() => {
      version = null
    })
    return version
  })

  ipcMain.handle(IPC.agentSetupRead, async (event, folder: unknown): Promise<AgentSetupRead> => {
    fromMainFrame(event, IPC.agentSetupRead)
    if (typeof folder !== 'string' || !(await isDirectory(folder))) {
      return { ok: false, reason: 'not-directory' }
    }
    let read = reading.get(folder)
    if (!read) {
      read = readAgentSetup({ folder, home: userHome(), bikubeSettings: claudeSettingsPath() })
        .then((snapshot): AgentSetupRead => {
          listed.set(folder, new Set(snapshot.paths))
          return { ok: true, snapshot }
        })
        .finally(() => reading.delete(folder))
      reading.set(folder, read)
    }
    return read
  })

  ipcMain.handle(
    IPC.agentSetupSwitch,
    async (event, folder: unknown, change: unknown): Promise<SettingsWriteResult> => {
      fromMainFrame(event, IPC.agentSetupSwitch)
      const edit = parseSwitchRequest(change)
      if (typeof folder !== 'string' || edit === null || !(await isDirectory(folder))) {
        return { ok: false, reason: 'refused', message: "Couldn't save: the request was refused" }
      }
      const before = writing.get(folder) ?? Promise.resolve<SettingsWriteResult>({ ok: true })
      const write = before
        .catch(() => undefined)
        .then(() => agentSetupWrite({ folder, home: userHome(), edit }))
      writing.set(folder, write)
      write
        .finally(() => {
          if (writing.get(folder) === write) writing.delete(folder)
        })
        .catch(() => {})
      return write
    }
  )
}
