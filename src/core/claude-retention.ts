/**
 * Claude Code's conversation retention (#80 D2–D4): `cleanupPeriodDays` in the user's
 * `~/.claude/settings.json`, read as low, ok or unknown, and raised to 3650 days. Plain TS with no
 * Electron imports: the file system is injected (Node's by default), so Vitest drives real
 * temporary folders. `home` is `BIKUBE_HOME_DIR` else the OS home, main's `userHome()`.
 */

import { join } from 'node:path'
import type { SettingsWriteResult } from './agent-setup-snapshot'
import { nodeSettingsFs, writeSettingsJson, type SettingsFs } from './settings-local-writer'
import type { ClaudeRetention } from './claude-retention-types'

export type { ClaudeRetention } from './claude-retention-types'

/** The value Bikube sets (D3): about ten years. */
export const CLAUDE_RETENTION_DAYS = 3650

/** Claude Code's own default when nothing sets it. */
export const CLAUDE_DEFAULT_CLEANUP_DAYS = 30

const KEY = 'cleanupPeriodDays'
const NAME = 'settings.json'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** What a file's (or no file's) value reads as (D3); `undefined` when it is unset. */
function retentionOf(value: unknown): ClaudeRetention {
  if (value === undefined) return { state: 'low', days: CLAUDE_DEFAULT_CLEANUP_DAYS }
  if (!isNumber(value)) return { state: 'unknown' }
  return value < CLAUDE_RETENTION_DAYS ? { state: 'low', days: value } : { state: 'ok' }
}

/**
 * Reads `<home>/.claude/settings.json`'s `cleanupPeriodDays` (D3): low (with the days in effect)
 * when unset or below 3650, ok from 3650; unknown for a non-number value, an unreadable or invalid
 * file, a non-object, or when the file or `.claude` is a link or the file isn't a regular one.
 */
export async function readClaudeRetention(
  home: string,
  fs: Pick<SettingsFs, 'lstat' | 'readFile'> = nodeSettingsFs
): Promise<ClaudeRetention> {
  const dir = join(home, '.claude')
  const file = join(dir, NAME)
  for (const [path, regular] of [
    [dir, false],
    [file, true]
  ] as const) {
    try {
      const info = await fs.lstat(path)
      if (info.isSymbolicLink()) return { state: 'unknown' }
      if (regular && !info.isFile()) return { state: 'unknown' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return retentionOf(undefined)
      return { state: 'unknown' }
    }
  }
  try {
    const settings = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    return isRecord(settings) ? retentionOf(settings[KEY]) : { state: 'unknown' }
  } catch {
    return { state: 'unknown' }
  }
}

/**
 * Sets `cleanupPeriodDays` to 3650 in `<home>/.claude/settings.json` (D4), with the Agent setup
 * writer's rules: the file read again first, only that key changed, `.claude/` and the file
 * created when missing, nothing written through a link, over invalid JSON, a non-object or a
 * non-number value. A value of 3650 or more is left alone (D3) and reads as success.
 */
export function setClaudeRetention(
  home: string,
  fs: SettingsFs = nodeSettingsFs
): Promise<SettingsWriteResult> {
  return writeSettingsJson(
    join(home, '.claude'),
    NAME,
    (settings) => {
      const value = settings[KEY]
      if (value !== undefined && !isNumber(value)) {
        return {
          ok: false,
          reason: 'unexpected-value',
          message: `Couldn't save: ${KEY} in ${NAME} isn't a number`
        }
      }
      if (isNumber(value) && value >= CLAUDE_RETENTION_DAYS) return 'unchanged'
      settings[KEY] = CLAUDE_RETENTION_DAYS
      return null
    },
    fs
  )
}
