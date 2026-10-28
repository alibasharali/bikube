import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  ListedPaths,
  openListedFile,
  revealListedFile,
  type FileActionDeps
} from '../core/agent-setup-open'
import { readAgentSetup } from '../core/agent-setup-reader'
import type { AgentSetupRead, SettingsWriteResult } from '../core/agent-setup-snapshot'
import {
  agentSetupConfigWrite,
  agentSetupWrite,
  parseConfigEdit,
  parseSwitchRequest
} from '../core/agent-setup-writes'
import { localDateOf, readClaudeStats, statsFolders } from '../core/claude-stats'
import type { ClaudeStatsRead } from '../core/claude-stats-types'
import { readClaudeVersion, type ClaudeVersion } from '../core/claude-version'
import { isDirectory } from '../core/directories'
import { editorShell, type OpenResult } from '../core/editor'
import type { Settings } from '../core/settings'
import { IPC } from '../shared/api'
import { claudeSettingsPath } from './board'
import { editorLocation } from './editors'

/** Each folder's running read, shared by requests made during it (#68 D26: never two at once). */
const reading = new Map<string, Promise<AgentSetupRead>>()

/** The files each folder's last read found (D28): Open file and Reveal accept only these. */
const listed = new ListedPaths()

/** Each Stats request's running read (D14), by its folders: a request during it shares it. */
const statsReading = new Map<string, Promise<ClaudeStatsRead>>()

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
 * a plugin key `installed_plugins.json` lists or a server name `.mcp.json` lists; `agentSetup:config`
 * sets a boolean or number setting there, or removes one it sets (D22, `agentSetupConfigWrite`);
 * one write at a time per folder across both; `agentSetup:open` and `agentSetup:reveal` open a file
 * with Settings > Editor `editorSettings()` (its own folder the project folder) or show it in the
 * file manager (D27), only a file the folder's last read listed; `agentSetup:stats` reads the
 * Claude Code transcripts of the folder and its worktree folders (D14, `statsFolders`). Requests come from the main frame only and must name an absolute, existing
 * directory; nothing a file names is run.
 */
export function registerAgentSetup(
  editorSettings: () => Pick<Settings, 'editor' | 'editorCommand' | 'shell'>
): void {
  const shellSetting = (): string => editorSettings().shell
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

  ipcMain.handle(IPC.agentSetupRead, async (event, requested: unknown): Promise<AgentSetupRead> => {
    fromMainFrame(event, IPC.agentSetupRead)
    if (typeof requested !== 'string' || !(await isDirectory(requested))) {
      return { ok: false, reason: 'not-directory' }
    }
    // One read per folder however it is spelled (`/a` and `/a/`).
    const folder = resolve(requested)
    let read = reading.get(folder)
    if (!read) {
      read = readAgentSetup({ folder, home: userHome(), bikubeSettings: claudeSettingsPath() })
        .then((snapshot): AgentSetupRead => {
          listed.set(folder, snapshot.paths)
          return { ok: true, snapshot }
        })
        .finally(() => reading.delete(folder))
      reading.set(folder, read)
    }
    return read
  })

  ipcMain.handle(
    IPC.agentSetupStats,
    async (event, requested: unknown, extra: unknown): Promise<ClaudeStatsRead> => {
      fromMainFrame(event, IPC.agentSetupStats)
      const folders = await statsFolders(requested, extra)
      if (!folders) return { ok: false }
      const key = folders.join('\0')
      let read = statsReading.get(key)
      if (!read) {
        read = readClaudeStats({
          home: userHome(),
          folders,
          now: Date.now(),
          localDate: localDateOf
        })
          .then((stats): ClaudeStatsRead => ({ ok: true, stats }))
          .finally(() => statsReading.delete(key))
        statsReading.set(key, read)
      }
      return read
    }
  )

  /**
   * Runs `write` after the folder's earlier writes; refused when the request named no folder or
   * no edit main takes (`write` null).
   */
  const queueWrite = async (
    requested: unknown,
    write: ((folder: string) => Promise<SettingsWriteResult>) | null
  ): Promise<SettingsWriteResult> => {
    if (typeof requested !== 'string' || !write || !(await isDirectory(requested))) {
      return { ok: false, reason: 'refused', message: "Couldn't save: the request was refused" }
    }
    // One write per folder however it is spelled (`/a` and `/a/`).
    const folder = resolve(requested)
    const before = writing.get(folder) ?? Promise.resolve<SettingsWriteResult>({ ok: true })
    const next = before.catch(() => undefined).then(() => write(folder))
    writing.set(folder, next)
    next
      .finally(() => {
        if (writing.get(folder) === next) writing.delete(folder)
      })
      .catch(() => {})
    return next
  }

  ipcMain.handle(
    IPC.agentSetupSwitch,
    (event, requested: unknown, change: unknown): Promise<SettingsWriteResult> => {
      fromMainFrame(event, IPC.agentSetupSwitch)
      const edit = parseSwitchRequest(change)
      return queueWrite(
        requested,
        edit && ((folder) => agentSetupWrite({ folder, home: userHome(), edit }))
      )
    }
  )

  ipcMain.handle(
    IPC.agentSetupConfig,
    (event, requested: unknown, change: unknown): Promise<SettingsWriteResult> => {
      fromMainFrame(event, IPC.agentSetupConfig)
      const edit = parseConfigEdit(change)
      return queueWrite(
        requested,
        edit && ((folder) => agentSetupConfigWrite({ folder, home: userHome(), edit }))
      )
    }
  )

  const fileActions = (): FileActionDeps => {
    const { editor, editorCommand, shell: login } = editorSettings()
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined) env[key] = value
    return {
      listed,
      open: {
        editor,
        editorCommand,
        shell: editorShell(login, env),
        env,
        ...editorLocation(),
        spawn,
        openPath: (file: string) => shell.openPath(file)
      },
      reveal: (file: string) => shell.showItemInFolder(file)
    }
  }

  ipcMain.handle(
    IPC.agentSetupOpen,
    (event, folder: unknown, path: unknown): Promise<OpenResult> => {
      fromMainFrame(event, IPC.agentSetupOpen)
      return openListedFile(folder, path, fileActions())
    }
  )

  ipcMain.handle(
    IPC.agentSetupReveal,
    (event, folder: unknown, path: unknown): Promise<boolean> => {
      fromMainFrame(event, IPC.agentSetupReveal)
      return revealListedFile(folder, path, fileActions())
    }
  )
}
