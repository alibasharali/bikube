import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type {
  AgentSetupConfigEdit,
  AgentSetupSnapshot,
  AgentSetupSwitch,
  SettingsWriteResult
} from '../../core/agent-setup-snapshot'
import { worktreeFolders, type ClaudeStats } from '../../core/claude-stats-types'
import type { ClaudeVersion } from '../../core/claude-version'
import type { Workspace } from '../../core/workspace-store'
import { anyWindowFocused, onAnyWindowFocus } from './window-focus'

/**
 * The Agent setup page's data (#68 D26), kept per workspace folder for the run of the app (never
 * saved): the last snapshot main read, the last read's error, the expanded memory rows, and the
 * switches being saved with the last save's outcome (D23, D22's Config edits too). A
 * read replaces only the parts of the snapshot that changed, so rows that read as before keep
 * their objects; never two reads at a time for one folder.
 */

/** How often the page reads again while a Bikube window is focused (D26). */
export const REFRESH_MS = 3000

export interface AgentSetupData {
  /** Null until the first read ends. */
  snapshot: AgentSetupSnapshot | null
  /** The last read failed: shown while there is no snapshot. */
  failed: boolean
  /** Expanded memory rows' keys (D17), kept across reads. */
  expanded: ReadonlySet<string>
  /** Switches being saved (by `switchKey`), with the state asked for: shown until the read after it. */
  saving: ReadonlyMap<string, boolean>
  /** The last save's error line (D23), until a save succeeds. */
  saveError: string | null
  /** A switch was saved for this folder in this run: the page says changes apply from now on (D23). */
  saved: boolean
}

interface FolderData extends AgentSetupData {
  expanded: Set<string>
  saving: Map<string, boolean>
  version: number
}

const folders = new Map<string, FolderData>()
const reading = new Map<string, Promise<void>>()
/** Folders asked to read again while a read ran: exactly one more read follows it. */
const pending = new Set<string>()
const listeners = new Set<() => void>()

function dataOf(folder: string): FolderData {
  let data = folders.get(folder)
  if (!data) {
    data = {
      snapshot: null,
      failed: false,
      expanded: new Set(),
      saving: new Map(),
      saveError: null,
      saved: false,
      version: 0
    }
    folders.set(folder, data)
  }
  return data
}

const changed = (data: FolderData): void => {
  data.version++
  for (const listener of [...listeners]) listener()
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** `next` with every part (a top-level key, an array's item) that reads as in `before` kept from it. */
function merge(before: AgentSetupSnapshot, next: AgentSetupSnapshot): AgentSetupSnapshot {
  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    const old = (before as unknown as Record<string, unknown>)[key]
    if (same(old, value)) merged[key] = old
    else if (Array.isArray(value) && Array.isArray(old)) {
      merged[key] = value.map((item, i) => (same(old[i], item) ? old[i] : item))
    } else merged[key] = value
  }
  return merged as unknown as AgentSetupSnapshot
}

async function readOnce(folder: string): Promise<void> {
  const data = dataOf(folder)
  let next: AgentSetupSnapshot | null = null
  try {
    const read = await window.bikube.agentSetup.read(folder)
    if (read.ok) next = read.snapshot
  } catch {
    // Kept as failed below.
  }
  if (!next) {
    // A failed read keeps the snapshot read before it.
    if (data.snapshot === null && !data.failed) {
      data.failed = true
      changed(data)
    }
    return
  }
  const before = data.snapshot
  if (before && same(before, next) && !data.failed) return
  data.snapshot = before ? merge(before, next) : next
  data.failed = false
  changed(data)
}

/**
 * Reads `folder`'s setup again (D26). Asked for while a read runs (a poll, a Refresh click), it
 * reads once more when that read ends, never two at once; the promise ends after that read.
 */
export function refreshAgentSetup(folder: string): Promise<void> {
  const running = reading.get(folder)
  if (running) {
    pending.add(folder)
    return running
  }
  const run = (async () => {
    try {
      do {
        pending.delete(folder)
        await readOnce(folder)
      } while (pending.has(folder))
    } finally {
      pending.delete(folder)
      reading.delete(folder)
    }
  })()
  reading.set(folder, run)
  return run
}

/** Expands or collapses memory row `key` of `folder`'s page. */
export function toggleExpanded(folder: string, key: string): void {
  const data = dataOf(folder)
  if (!data.expanded.delete(key)) data.expanded.add(key)
  changed(data)
}

/** `folder`'s data, re-rendered on every change. */
export function useAgentSetupData(folder: string): AgentSetupData {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useSyncExternalStore(subscribe, () => dataOf(folder).version)
  const data = dataOf(folder)
  return {
    snapshot: data.snapshot,
    failed: data.failed,
    expanded: data.expanded,
    saving: data.saving,
    saveError: data.saveError,
    saved: data.saved
  }
}

/** The key of a switch in `saving`: `plugin:<key>`, `mcp:<name>` or a Config key's `config:<key>`. */
export const switchKey = (
  change:
    | { kind: 'plugin'; key: string }
    | { kind: 'mcpServer'; name: string }
    | { kind: 'config'; key: string }
): string =>
  change.kind === 'plugin'
    ? `plugin:${change.key}`
    : change.kind === 'config'
      ? `config:${change.key}`
      : `mcp:${change.name}`

/**
 * Saves a change through `write` (D23): a switch (`key` in `saving`) shows `asked` at once, main
 * writes settings.local.json, and the page reads again; on a failure the switch goes back to the
 * state read and the error line shows.
 */
async function save(
  folder: string,
  asked: { key: string; state: boolean } | null,
  write: () => Promise<SettingsWriteResult>
): Promise<boolean> {
  const data = dataOf(folder)
  if (asked) {
    data.saving.set(asked.key, asked.state)
    changed(data)
  }
  let message: string | null = null
  try {
    const result = await write()
    if (!result.ok) message = result.message
  } catch {
    message = "Couldn't save settings.local.json"
  }
  if (message === null) {
    data.saveError = null
    data.saved = true
    changed(data)
    await refreshAgentSetup(folder)
  } else data.saveError = message
  // A later click on the same switch owns it now.
  if (asked && data.saving.get(asked.key) === asked.state) data.saving.delete(asked.key)
  changed(data)
  return message === null
}

/** Turns a plugin or a project MCP server on or off for `folder` (D15, D16, D23). */
export async function saveSwitch(folder: string, change: AgentSetupSwitch): Promise<void> {
  await save(folder, { key: switchKey(change), state: change.enabled }, () =>
    window.bikube.agentSetup.setSwitch(folder, change)
  )
}

/**
 * Changes a Config setting for `folder` (D22, D23): a boolean's switch shows the state asked for
 * at once, as `saveSwitch`'s does; a number or a Reset shows once read again. Resolves whether it
 * was saved.
 */
export function saveConfig(folder: string, edit: AgentSetupConfigEdit): Promise<boolean> {
  const asked =
    edit.kind === 'set' && typeof edit.value === 'boolean'
      ? { key: switchKey({ kind: 'config', key: edit.key }), state: edit.value }
      : null
  return save(folder, asked, () => window.bikube.agentSetup.editConfig(folder, edit))
}

/**
 * Reads `folder`'s setup at once, every 3 seconds while a Bikube window is focused, and when one
 * gains the focus (D26, #53 D10); nothing once the page is gone (Back, another card opened).
 */
export function useAgentSetupRefresh(folder: string): void {
  useEffect(() => {
    void refreshAgentSetup(folder)
    const timer = setInterval(() => {
      if (anyWindowFocused()) void refreshAgentSetup(folder)
    }, REFRESH_MS)
    const stopFocus = onAnyWindowFocus(() => void refreshAgentSetup(folder))
    return () => {
      clearInterval(timer)
      stopFocus()
    }
  }, [folder])
}

/**
 * Status' Claude Code row (#68 D13): `claude --version` through the login shell, read when the
 * page opens and on Refresh only, never on the periodic refresh (D26). Not per folder: it is the
 * same claude for every workspace. `result` is undefined before the first read ends and null when
 * the check failed.
 */
export interface ClaudeVersionState {
  reading: boolean
  result: ClaudeVersion | null | undefined
}

let claudeVersion: ClaudeVersionState = { reading: false, result: undefined }
let versionRead: Promise<void> | null = null

const setClaudeVersion = (next: ClaudeVersionState): void => {
  claudeVersion = next
  for (const listener of [...listeners]) listener()
}

/** Reads Claude Code's version again; one read at a time, a request during it sharing it. */
export function refreshClaudeVersion(): Promise<void> {
  versionRead ??= (async () => {
    setClaudeVersion({ ...claudeVersion, reading: true })
    let result: ClaudeVersion | null = null
    try {
      result = await window.bikube.agentSetup.claudeVersion()
    } catch {
      // A failed check reads as null.
    }
    setClaudeVersion({ reading: false, result })
  })().finally(() => {
    versionRead = null
  })
  return versionRead
}

/** Claude Code's version as last read, re-rendered on every change. */
export function useClaudeVersion(): ClaudeVersionState {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return useSyncExternalStore(subscribe, () => claudeVersion)
}

/**
 * Stats (#68 D14), kept per workspace folder for the run: read when the section is first shown
 * and on Refresh only, never on the periodic refresh (D26). `stats` is undefined until a read
 * ends and null when main refused it or it failed; a read keeps the last stats shown meanwhile.
 */
export interface StatsState {
  reading: boolean
  stats: ClaudeStats | null | undefined
}

const stats = new Map<string, StatsState>()
const statsReads = new Map<string, Promise<void>>()
/** Folders asked to read Stats again while a read ran: exactly one more read follows it. */
const statsPending = new Map<string, readonly string[]>()
const NO_STATS: StatsState = { reading: false, stats: undefined }

const setStats = (folder: string, next: StatsState): void => {
  stats.set(folder, next)
  for (const listener of [...listeners]) listener()
}

/**
 * Reads `folder`'s Stats with the worktree folders `extra`; asked for while a read runs, it reads
 * once more when that one ends, never two at once.
 */
export function refreshStats(folder: string, extra: readonly string[]): Promise<void> {
  const running = statsReads.get(folder)
  if (running) {
    statsPending.set(folder, extra)
    return running
  }
  const run = (async () => {
    let folders: readonly string[] | undefined = extra
    try {
      while (folders) {
        statsPending.delete(folder)
        setStats(folder, { ...(stats.get(folder) ?? NO_STATS), reading: true })
        let result: ClaudeStats | null = null
        try {
          const read = await window.bikube.agentSetup.stats(folder, [...folders])
          if (read.ok) result = read.stats
        } catch {
          // Shown as failed below.
        }
        // A failed read keeps the stats read before it.
        setStats(folder, { reading: false, stats: result ?? stats.get(folder)?.stats ?? null })
        folders = statsPending.get(folder)
      }
    } finally {
      statsPending.delete(folder)
      statsReads.delete(folder)
    }
  })()
  statsReads.set(folder, run)
  return run
}

/** Whether Stats were asked for `folder` in this run: Refresh reads them again only then. */
export const statsRequested = (folder: string): boolean => stats.has(folder)

/** `folder`'s Stats as last read, re-rendered on every change. */
export function useStats(folder: string): StatsState {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return useSyncExternalStore(subscribe, () => stats.get(folder) ?? NO_STATS)
}

/** The folders Stats count for `workspace` besides its own: its worktree cards' (D14). */
export const statsExtraFolders = (workspace: Workspace): string[] =>
  worktreeFolders(workspace.cards)

/** Reads `workspace`'s Stats again on Refresh, once they were shown in this run (D26). */
export function refreshStatsIfShown(workspace: Workspace): void {
  if (statsRequested(workspace.directory)) {
    void refreshStats(workspace.directory, statsExtraFolders(workspace))
  }
}
