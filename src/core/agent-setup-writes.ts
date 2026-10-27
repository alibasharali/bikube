/**
 * Main's check of the Agent setup page's switches (#68 D28) before settings.local.json is written
 * (`settings-local-writer.ts`, D23): a plugin switch only for a key `~/.claude/plugins/
 * installed_plugins.json` lists, a project MCP server switch only for a name `<folder>/.mcp.json`
 * lists, both files read again for each request. Anything else is refused and nothing is written.
 * A server switch also gets the lists in effect in the lower settings files (D10), which the
 * writer copies into settings.local.json when it lacks them, so the change holds.
 * D22's edits (S5) add their own check beside these.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSetupSwitch, SettingsWriteResult } from './agent-setup-snapshot'
import { writeSettingsLocal, type McpListKey, type SettingsFs } from './settings-local-writer'

/** The longest plugin key or server name taken. */
const MAX_NAME = 512

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A switch request from the renderer, or null when it isn't one. */
export function parseSwitchRequest(value: unknown): AgentSetupSwitch | null {
  if (!isRecord(value) || typeof value['enabled'] !== 'boolean') return null
  const enabled = value['enabled']
  if (value['kind'] === 'plugin' && isName(value['key'])) {
    return { kind: 'plugin', key: value['key'], enabled }
  }
  if (value['kind'] === 'mcpServer' && isName(value['name'])) {
    return { kind: 'mcpServer', name: value['name'], enabled }
  }
  return null
}

/** The object at `key` of the JSON file `path`, or null when it can't be read. */
async function readObject(
  path: string,
  key: string,
  read: (path: string, encoding: 'utf8') => Promise<string>
): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await read(path, 'utf8')) as unknown
    return isRecord(value) && isRecord(value[key]) ? value[key] : null
  } catch {
    return null
  }
}

export interface AgentSetupWriteOptions {
  /** The workspace folder (absolute, an existing directory: the caller checked it). */
  folder: string
  /** The user's home (main's `BIKUBE_HOME_DIR`, else the OS home). */
  home: string
  edit: AgentSetupSwitch
  fs?: SettingsFs
}

/** Writes `edit` to settings.local.json when D28 allows it. */
export async function agentSetupWrite({
  folder,
  home,
  edit,
  fs
}: AgentSetupWriteOptions): Promise<SettingsWriteResult> {
  const read = fs?.readFile.bind(fs) ?? readFile
  const listed =
    edit.kind === 'plugin'
      ? await readObject(
          join(home, '.claude', 'plugins', 'installed_plugins.json'),
          'plugins',
          read
        )
      : await readObject(join(folder, '.mcp.json'), 'mcpServers', read)
  const name = edit.kind === 'plugin' ? edit.key : edit.name
  if (!listed || !Object.hasOwn(listed, name)) {
    return {
      ok: false,
      reason: 'refused',
      message: "Couldn't save: not listed in this workspace's setup"
    }
  }
  if (edit.kind === 'plugin') return writeSettingsLocal(folder, edit, fs)
  return writeSettingsLocal(
    folder,
    { ...edit, inherited: await lowerLists(folder, home, read) },
    fs
  )
}

/**
 * The project MCP server lists in effect below settings.local.json (D10): each the first of
 * `<folder>/.claude/settings.json` and `~/.claude/settings.json` that sets it, read again now.
 */
async function lowerLists(
  folder: string,
  home: string,
  read: (path: string, encoding: 'utf8') => Promise<string>
): Promise<Partial<Record<McpListKey, string[]>>> {
  const files: Record<string, unknown>[] = []
  for (const path of [
    join(folder, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.json')
  ]) {
    try {
      const value = JSON.parse(await read(path, 'utf8')) as unknown
      if (isRecord(value)) files.push(value)
    } catch {
      // A missing or invalid file sets nothing.
    }
  }
  const lists: Partial<Record<McpListKey, string[]>> = {}
  for (const key of ['enabledMcpjsonServers', 'disabledMcpjsonServers'] as const) {
    const setter = files.find((file) => Object.hasOwn(file, key))
    const value = setter?.[key]
    if (Array.isArray(value)) lists[key] = value.filter((n): n is string => typeof n === 'string')
  }
  return lists
}
