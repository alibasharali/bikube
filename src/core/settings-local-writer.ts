/**
 * Writes a workspace's `<folder>/.claude/settings.local.json` (#68 D23): the only file the Agent
 * setup page changes. The file is read again just before each write, only the edit's key changes
 * (every other key and the key order kept), and the result is 2-space-indented JSON with a final
 * newline, written to a temporary file in the same folder and renamed over the file; `.claude/` and
 * the file are created when missing. A file that exists but isn't valid JSON (or isn't an object,
 * or holds the edited key in another form) is never written. Plain TS with no Electron imports: the
 * file system is injected (Node's by default), so Vitest drives real temporary folders.
 *
 * Which edits are allowed (D28: a listed plugin, a `.mcp.json` server, a boolean or number setting)
 * is the caller's check; this module only applies them.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsWriteResult } from './agent-setup-snapshot'

/** One change to settings.local.json. */
export type SettingsEdit =
  /** `enabledPlugins[key] = enabled` (D15). */
  | { kind: 'plugin'; key: string; enabled: boolean }
  /** `name` into `enabledMcpjsonServers` and out of `disabledMcpjsonServers`, or the reverse (D16). */
  | { kind: 'mcpServer'; name: string; enabled: boolean }
  /** A top-level key set to a boolean or a finite number (D22). */
  | { kind: 'set'; key: string; value: boolean | number }
  /** A top-level key removed (D22's Reset). */
  | { kind: 'remove'; key: string }

/** The file system calls a write makes. */
export interface SettingsFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  stat(path: string): Promise<{ mode: number }>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  writeFile(path: string, data: string, options: { mode: number; flag: 'wx' }): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
}

export const nodeSettingsFs: SettingsFs = { readFile, stat, mkdir, writeFile, rename, unlink }

/** The file's name, as messages name it. */
const NAME = 'settings.local.json'

/** `<folder>/.claude/settings.local.json`. */
export const settingsLocalPath = (folder: string): string =>
  join(folder, '.claude', 'settings.local.json')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const failure = (
  reason: Exclude<SettingsWriteResult, { ok: true }>['reason'],
  message: string
): SettingsWriteResult => ({ ok: false, reason, message })

/**
 * `settings` with `edit` applied in place (an existing key keeps its place, a new one goes last),
 * or why it can't be: the key holds something other than the object or list the edit changes.
 */
function applyEdit(
  settings: Record<string, unknown>,
  edit: SettingsEdit
): SettingsWriteResult | null {
  switch (edit.kind) {
    case 'plugin': {
      const plugins = settings['enabledPlugins'] ?? {}
      if (!isRecord(plugins)) {
        return failure(
          'unexpected-value',
          `Couldn't save: enabledPlugins in ${NAME} isn't an object`
        )
      }
      plugins[edit.key] = edit.enabled
      settings['enabledPlugins'] = plugins
      return null
    }
    case 'mcpServer': {
      const [into, outOf] = edit.enabled
        ? ['enabledMcpjsonServers', 'disabledMcpjsonServers']
        : ['disabledMcpjsonServers', 'enabledMcpjsonServers']
      for (const key of [into, outOf]) {
        if (settings[key] !== undefined && !Array.isArray(settings[key])) {
          return failure('unexpected-value', `Couldn't save: ${key} in ${NAME} isn't a list`)
        }
      }
      const add = (settings[into] as unknown[] | undefined) ?? []
      if (!add.includes(edit.name)) add.push(edit.name)
      settings[into] = add
      // The other list loses the name; a list that isn't there isn't created.
      const remove = settings[outOf] as unknown[] | undefined
      if (remove) settings[outOf] = remove.filter((name) => name !== edit.name)
      return null
    }
    case 'set':
      settings[edit.key] = edit.value
      return null
    case 'remove':
      delete settings[edit.key]
      return null
  }
}

/** Applies `edit` to `<folder>/.claude/settings.local.json` (D23). */
export async function writeSettingsLocal(
  folder: string,
  edit: SettingsEdit,
  fs: SettingsFs = nodeSettingsFs
): Promise<SettingsWriteResult> {
  const dir = join(folder, '.claude')
  const file = settingsLocalPath(folder)
  let text: string | null = null
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return failure('failed', `Couldn't save ${NAME}: ${(error as Error).message}`)
    }
  }
  if (text === null && edit.kind === 'remove') return { ok: true }
  let settings: unknown = {}
  if (text !== null) {
    try {
      settings = JSON.parse(text) as unknown
    } catch {
      return failure('invalid-json', `Couldn't save: ${NAME} is not valid JSON`)
    }
  }
  if (!isRecord(settings)) {
    return failure('not-object', `Couldn't save: ${NAME} is not a JSON object`)
  }
  const refused = applyEdit(settings, edit)
  if (refused) return refused

  let mode = 0o644
  if (text !== null) {
    try {
      mode = (await fs.stat(file)).mode & 0o777
    } catch {
      // Written with the default mode.
    }
  }
  const temp = join(dir, `.${NAME}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(temp, JSON.stringify(settings, null, 2) + '\n', { mode, flag: 'wx' })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.unlink(temp).catch(() => {})
    return failure('failed', `Couldn't save ${NAME}: ${(error as Error).message}`)
  }
  return { ok: true }
}
