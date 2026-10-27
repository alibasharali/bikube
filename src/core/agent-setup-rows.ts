/**
 * The Agent setup page's rows from a snapshot (#68 D12, D18, D24, D25): each section's matching
 * rows and count split by source, the search, the warnings list and a plugin entry's off state.
 * Plain TS with no Node or DOM imports: the renderer runs it.
 *
 * Sections with rows are those `sectionSummaries` returns; later slices add theirs (Plugins, MCP
 * servers) there, and their warnings to `setupWarnings`. Hooks (D19), Permissions (D20) and
 * Status' rows (D13) are read here too.
 */

import type { AgentSetupSectionId } from './agent-setup-sections'
import {
  sourceLabel,
  type AgentSetupSnapshot,
  type DefinitionEntry,
  type EntrySource,
  type HookEntry,
  type JsonFileState,
  type MemoryEntry,
  type SettingsFile
} from './agent-setup-snapshot'

/** The search's terms: lower case, split on spaces (D25). */
const terms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Whether every term of `query` is found in one of `fields`, ignoring case (D25); an empty query matches. */
export function matchesQuery(
  query: string,
  fields: readonly (string | null | undefined)[]
): boolean {
  const wanted = terms(query)
  if (wanted.length === 0) return true
  const text = fields.filter(Boolean).join('\n').toLowerCase()
  return wanted.every((term) => text.includes(term))
}

const definitionFields = (entry: DefinitionEntry): (string | null | undefined)[] => [
  entry.name,
  entry.description,
  entry.argumentHint,
  entry.model,
  ...(entry.tools ?? []),
  sourceLabel(entry.source)
]

/** The skills, agents or commands matching `query` (D25). */
export function filterDefinitions(
  entries: readonly DefinitionEntry[],
  query: string
): DefinitionEntry[] {
  return entries.filter((entry) => matchesQuery(query, definitionFields(entry)))
}

const memoryMatches = (entry: MemoryEntry, query: string): boolean =>
  matchesQuery(query, [entry.label, entry.file, sourceLabel(entry.source)])

/**
 * The memory files matching `query`, or holding an import that does, each with only its matching
 * imports (all of them when it matches itself).
 */
export function filterMemory(entries: readonly MemoryEntry[], query: string): MemoryEntry[] {
  if (terms(query).length === 0) return [...entries]
  const kept: MemoryEntry[] = []
  for (const entry of entries) {
    if (memoryMatches(entry, query)) kept.push(entry)
    else {
      const imports = filterMemory(entry.imports, query)
      if (imports.length > 0) kept.push({ ...entry, imports })
    }
  }
  return kept
}

/** Every memory row of `entries`, imports included. */
function memoryRows(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return entries.flatMap((entry) => [entry, ...memoryRows(entry.imports)])
}

/** Hook events in the order Claude Code's hooks reference lists them (D19). */
export const HOOK_EVENT_ORDER: readonly string[] = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Notification',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd'
]

/** One event's hooks (D19). */
export interface HookGroup {
  event: string
  hooks: HookEntry[]
}

const hookMatches = (hook: HookEntry, query: string): boolean =>
  matchesQuery(query, [hook.event, hook.matcher ?? 'All', hook.command, sourceLabel(hook.source)])

/**
 * The hooks matching `query`, grouped by event: known events in Claude Code's order, unknown ones
 * after them by name (D19); within an event, as read (Bikube's, local, project, user, plugins).
 */
export function hookGroups(hooks: readonly HookEntry[], query: string): HookGroup[] {
  const groups = new Map<string, HookEntry[]>()
  for (const hook of hooks) {
    if (!hookMatches(hook, query)) continue
    const group = groups.get(hook.event)
    if (group) group.push(hook)
    else groups.set(hook.event, [hook])
  }
  const rank = (event: string): number => {
    const at = HOOK_EVENT_ORDER.indexOf(event)
    return at === -1 ? HOOK_EVENT_ORDER.length : at
  }
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([event, hooks]) => ({ event, hooks }))
}

/** A settings file's source chip (D9). */
const settingsSource = (file: SettingsFile): EntrySource => ({ kind: file.scope })

/** The effective value of settings key `key` (D10): the first file, by precedence, that sets it. */
export function effectiveSetting(
  settings: readonly SettingsFile[],
  key: string
): { value: unknown; file: SettingsFile } | null {
  for (const file of settings) {
    if (file.value && Object.hasOwn(file.value, key)) return { value: file.value[key], file }
  }
  return null
}

/** A permission rule or additional directory with where it is set (D20). */
export interface PermissionRule {
  rule: string
  source: EntrySource
  file: string
}

/** Permissions (D20): the effective `defaultMode` and every source's rules, merged (D10). */
export interface PermissionsView {
  defaultMode: { value: string; source: EntrySource; file: string } | null
  allow: PermissionRule[]
  ask: PermissionRule[]
  deny: PermissionRule[]
  additionalDirectories: PermissionRule[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The permission rules matching `query` (D25), by precedence; `defaultMode` is never filtered. */
export function permissionsView(snapshot: AgentSetupSnapshot, query: string): PermissionsView {
  const view: PermissionsView = {
    defaultMode: null,
    allow: [],
    ask: [],
    deny: [],
    additionalDirectories: []
  }
  for (const file of snapshot.settings) {
    const permissions = file.value?.['permissions']
    if (!isObject(permissions)) continue
    const source = settingsSource(file)
    const mode = permissions['defaultMode']
    if (view.defaultMode === null && typeof mode === 'string') {
      view.defaultMode = { value: mode, source, file: file.file }
    }
    for (const list of ['allow', 'ask', 'deny', 'additionalDirectories'] as const) {
      const rules = permissions[list]
      if (!Array.isArray(rules)) continue
      for (const rule of rules) {
        if (typeof rule !== 'string') continue
        if (!matchesQuery(query, [rule, sourceLabel(source)])) continue
        view[list].push({ rule, source, file: file.file })
      }
    }
  }
  return view
}

/** Status' account line (D13): `<email> · <organization>`, or `Not signed in`. */
export function accountText(snapshot: AgentSetupSnapshot): string {
  const account = snapshot.claudeJson.oauthAccount
  const parts = [account?.emailAddress, account?.organizationName].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Not signed in'
}

/** One of Status' settings files (D13). */
export interface SettingsFileState {
  file: string
  source: EntrySource
  state: JsonFileState
  error?: string
}

/**
 * Status' settings files (D13): Bikube's (when read), the three settings files by precedence,
 * `~/.claude.json` and `.mcp.json`, each Found, Missing or Invalid.
 */
export function settingsFileStates(snapshot: AgentSetupSnapshot): SettingsFileState[] {
  const state = (
    file: { file: string; state: JsonFileState; error?: string },
    source: EntrySource
  ): SettingsFileState => ({
    file: file.file,
    source,
    state: file.state,
    ...(file.error !== undefined ? { error: file.error } : {})
  })
  return [
    ...(snapshot.bikubeSettings ? [state(snapshot.bikubeSettings, { kind: 'bikube' })] : []),
    ...snapshot.settings.map((file) => state(file, settingsSource(file))),
    state(snapshot.claudeJson, { kind: 'user' }),
    state(snapshot.mcpJson, { kind: 'project' })
  ]
}

/** The groups an Overview card splits a count into, in this order (D12). */
const SOURCE_GROUPS = ['Project', 'Local', 'User', 'Plugin', 'Bikube'] as const
type SourceGroup = (typeof SOURCE_GROUPS)[number]

const sourceGroup = (source: EntrySource): SourceGroup =>
  source.kind === 'plugin' ? 'Plugin' : (sourceLabel(source) as SourceGroup)

/** A section's matching rows: their count and how many come from each source. */
export interface SectionSummary {
  count: number
  bySource: Partial<Record<SourceGroup, number>>
}

function summary(sources: readonly EntrySource[], more = 0): SectionSummary {
  const bySource: SectionSummary['bySource'] = {}
  for (const source of sources) {
    const group = sourceGroup(source)
    bySource[group] = (bySource[group] ?? 0) + 1
  }
  return { count: sources.length + more, bySource }
}

/** An Overview card's split, e.g. `1 Project · 1 User · 1 Plugin` (D12); empty with no rows. */
export function sourceSplit(summary: SectionSummary): string {
  return SOURCE_GROUPS.filter((group) => summary.bySource[group])
    .map((group) => `${summary.bySource[group]} ${group}`)
    .join(' · ')
}

/**
 * Each section with rows: the count of its rows matching `query` (all of them for an empty one),
 * D11's rows past a folder's limit counted while nothing is searched.
 */
export function sectionSummaries(
  snapshot: AgentSetupSnapshot,
  query: string
): Partial<Record<AgentSetupSectionId, SectionSummary>> {
  const searching = terms(query).length > 0
  const definitions = (id: 'skills' | 'agents' | 'commands'): SectionSummary =>
    summary(
      filterDefinitions(snapshot[id], query).map((e) => e.source),
      searching ? 0 : (snapshot.more[id] ?? 0)
    )
  return {
    skills: definitions('skills'),
    agents: definitions('agents'),
    commands: definitions('commands'),
    hooks: summary(hookGroups(snapshot.hooks, query).flatMap((g) => g.hooks.map((h) => h.source))),
    memory: summary(
      memoryRows(snapshot.memory)
        .filter((entry) => memoryMatches(entry, query))
        .map((e) => e.source)
    ),
    permissions: summary(permissionRules(permissionsView(snapshot, query)).map((r) => r.source))
  }
}

/** Every rule and additional directory of `view`: the Permissions section's rows. */
export function permissionRules(view: PermissionsView): PermissionRule[] {
  return [...view.allow, ...view.ask, ...view.deny, ...view.additionalDirectories]
}

/** One line of the Overview's Warnings list (D12, D24). */
export interface SetupWarning {
  section: AgentSetupSectionId
  /** The entry's name, or the file's label for a file without a row. */
  entry: string
  file: string
  message: string
}

/** Every warning on the page (D24), file warnings first, then by section in list order. */
export function setupWarnings(snapshot: AgentSetupSnapshot): SetupWarning[] {
  const warnings: SetupWarning[] = snapshot.fileWarnings.map((w) => ({ ...w }))
  for (const plugin of snapshot.plugins) {
    for (const message of plugin.warnings) {
      warnings.push({ section: 'plugins', entry: plugin.key, file: plugin.installPath, message })
    }
  }
  for (const section of ['skills', 'agents', 'commands'] as const) {
    for (const entry of snapshot[section]) {
      for (const message of entry.warnings) {
        warnings.push({ section, entry: entry.name, file: entry.file, message })
      }
    }
  }
  for (const hook of snapshot.hooks) {
    for (const message of hook.warnings) {
      warnings.push({
        section: 'hooks',
        entry: `${hook.event} · ${hook.command}`,
        file: hook.file ?? snapshot.bikubeSettings?.file ?? '',
        message
      })
    }
  }
  for (const entry of memoryRows(snapshot.memory)) {
    for (const message of entry.warnings) {
      warnings.push({ section: 'memory', entry: entry.label, file: entry.file, message })
    }
  }
  return warnings
}

/** A plugin's entry while its plugin is off for this folder: shown dimmed, `Plugin off` (D18). */
export function isPluginOff(snapshot: AgentSetupSnapshot, entry: { source: EntrySource }): boolean {
  const { source } = entry
  if (source.kind !== 'plugin') return false
  return snapshot.plugins.find((p) => p.key === source.key)?.enabled !== true
}

/** `file` as the page shows it: relative inside the workspace folder, `~/…` inside the home, else as it is. */
export function fileLabel(
  snapshot: Pick<AgentSetupSnapshot, 'folder' | 'home'>,
  file: string
): string {
  const inside = (base: string): string | null => {
    const prefix = base.endsWith('/') ? base : `${base}/`
    return file.startsWith(prefix) ? file.slice(prefix.length) : null
  }
  const inFolder = inside(snapshot.folder)
  if (inFolder) return inFolder
  const inHome = inside(snapshot.home)
  return inHome ? `~/${inHome}` : file
}
