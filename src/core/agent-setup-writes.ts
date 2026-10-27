/**
 * Main's check of the Agent setup page's switches (#68 D28) before settings.local.json is written
 * (`settings-local-writer.ts`, D23): a plugin switch only for a key `~/.claude/plugins/
 * installed_plugins.json` lists, a project MCP server switch only for a name `<folder>/.mcp.json`
 * lists, both files read again for each request. Anything else is refused and nothing is written.
 * A server switch also gets the lists in effect in the lower settings files (D10), which the
 * writer copies into settings.local.json when it lacks them, so the change holds.
 * D22's Config edits have their own check (`agentSetupConfigWrite`): a set only for a key whose
 * effective value (D10, the three settings files read again) is a boolean or a finite number, with
 * a new value of the same kind; a remove only for a boolean or finite number settings.local.json
 * sets; never a key another section shows (`CONFIG_EXCLUDED_KEYS`), and no new keys.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_EXCLUDED_KEYS, configControl } from './agent-setup-rows'
import type {
  AgentSetupConfigEdit,
  AgentSetupSwitch,
  SettingsWriteResult
} from './agent-setup-snapshot'
import {
  settingsLocalPath,
  writeSettingsLocal,
  type McpListKey,
  type SettingsFs
} from './settings-local-writer'

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

/** A Config edit request from the renderer (D22), or null when it isn't one. */
export function parseConfigEdit(value: unknown): AgentSetupConfigEdit | null {
  if (!isRecord(value)) return null
  const key = value['key']
  if (!isName(key) || key === '__proto__') return null
  if (value['kind'] === 'remove') return { kind: 'remove', key }
  if (value['kind'] !== 'set') return null
  const v = value['value']
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
    return { kind: 'set', key, value: v }
  }
  return null
}

export interface AgentSetupConfigWriteOptions {
  /** The workspace folder (absolute, an existing directory: the caller checked it). */
  folder: string
  /** The user's home (main's `BIKUBE_HOME_DIR`, else the OS home). */
  home: string
  edit: AgentSetupConfigEdit
  fs?: SettingsFs
}

/** What a Config edit main turns down reads (D28). */
const CONFIG_REFUSED: SettingsWriteResult = {
  ok: false,
  reason: 'refused',
  message: "Couldn't save: only a boolean or number setting can be changed here"
}

/** The parsed object of JSON file `path`; `invalid` when it is there but not an object of JSON. */
async function readSettingsObject(
  path: string,
  read: (path: string, encoding: 'utf8') => Promise<string>
): Promise<Record<string, unknown> | 'missing' | 'invalid'> {
  let text: string
  try {
    text = await read(path, 'utf8')
  } catch {
    return 'missing'
  }
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : 'invalid'
  } catch {
    return 'invalid'
  }
}

/** Writes Config edit `edit` to settings.local.json when D28 allows it. */
export async function agentSetupConfigWrite({
  folder,
  home,
  edit,
  fs
}: AgentSetupConfigWriteOptions): Promise<SettingsWriteResult> {
  if (CONFIG_EXCLUDED_KEYS.includes(edit.key)) return CONFIG_REFUSED
  const read = fs?.readFile.bind(fs) ?? readFile
  const local = await readSettingsObject(settingsLocalPath(folder), read)
  if (edit.kind === 'remove') {
    // An invalid file gets the writer's own message, and is left as it is.
    if (local === 'invalid') return writeSettingsLocal(folder, edit, fs)
    if (local === 'missing' || !Object.hasOwn(local, edit.key)) return CONFIG_REFUSED
    // Only a value D22 lets the page change: a string, list, object or `env` is read-only (D28).
    if (edit.key === 'env' || configControl(local[edit.key]) === null) return CONFIG_REFUSED
    return writeSettingsLocal(folder, edit, fs)
  }
  // The effective value (D10), every file read again now.
  const files = [
    local,
    await readSettingsObject(join(folder, '.claude', 'settings.json'), read),
    await readSettingsObject(join(home, '.claude', 'settings.json'), read)
  ]
  const setter = files.find(
    (file): file is Record<string, unknown> => isRecord(file) && Object.hasOwn(file, edit.key)
  )
  const control = setter ? configControl(setter[edit.key]) : null
  const wanted = typeof edit.value === 'boolean' ? 'switch' : 'number'
  if (control !== wanted) return CONFIG_REFUSED
  return writeSettingsLocal(folder, edit, fs)
}
