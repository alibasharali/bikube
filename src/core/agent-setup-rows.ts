/**
 * The Agent setup page's rows from a snapshot (#68 D12, D18, D24, D25): each section's matching
 * rows and count split by source, the search, the warnings list and a plugin entry's off state.
 * Plain TS with no Node or DOM imports: the renderer runs it.
 *
 * Sections with rows are those `sectionSummaries` returns; a later slice adds its own there, and
 * its warnings to `setupWarnings`. Hooks (D19), Permissions (D20), Status' rows (D13), Plugins and
 * their marketplaces (D15), MCP servers (D16) and Config with its preferences (D21, D22) are read
 * here too.
 */

import { sandboxEntries, sandboxView } from './agent-setup-sandbox'
import type { AgentSetupSectionId } from './agent-setup-sections'
import {
  sourceLabel,
  type AgentSetupSnapshot,
  type DefinitionEntry,
  type EntrySource,
  type HookEntry,
  type JsonFileState,
  type MemoryEntry,
  type PluginEntry,
  type SettingsFile
} from './agent-setup-snapshot'

/** The source chips other than All and Plugin, in the chip row's order (#71 D3). */
export type SourceChipKind = 'project' | 'local' | 'user' | 'bikube'
const SOURCE_CHIP_KINDS: readonly SourceChipKind[] = ['project', 'local', 'user', 'bikube']

/**
 * The page's source filter (#71 D1): every source, one source kind, every plugin, or one plugin
 * by its `installed_plugins.json` key.
 */
export type SourceFilter =
  { kind: 'all' } | { kind: SourceChipKind } | { kind: 'plugins' } | { kind: 'plugin'; key: string }

/** The filter at its default: every source. */
export const ALL_SOURCES: SourceFilter = { kind: 'all' }

/** Whether two filters are the same choice. */
export const sameFilter = (a: SourceFilter, b: SourceFilter): boolean =>
  a.kind === b.kind && (a.kind !== 'plugin' || (b.kind === 'plugin' && a.key === b.key))

/**
 * Where a row comes from for the filter (#71 D2): its source chip's source, and the plugin it
 * belongs to (a plugin's entry, or an installed plugin's own row, whose chip reads its scope).
 */
interface RowOrigin {
  source: EntrySource
  plugin?: { key: string; name: string }
}

const origin = (source: EntrySource): RowOrigin =>
  source.kind === 'plugin'
    ? { source, plugin: { key: source.key, name: source.plugin } }
    : { source }

/** Whether a row from `row` shows under `filter` (#71 D2). */
function originMatches(filter: SourceFilter, row: RowOrigin): boolean {
  switch (filter.kind) {
    case 'all':
      return true
    case 'plugins':
      return row.plugin !== undefined
    case 'plugin':
      return row.plugin?.key === filter.key
    default:
      return row.source.kind === filter.kind
  }
}

/** Whether an entry from `source` shows under `filter` (#71 D2). */
export const matchesSource = (filter: SourceFilter, source: EntrySource): boolean =>
  originMatches(filter, origin(source))

/**
 * The filter's chip label (#71 D4): `All`, `Project`, …, `Plugin` for every plugin, `Plugin
 * <name>` for one (its key when the snapshot no longer lists it).
 */
export function filterLabel(
  snapshot: Pick<AgentSetupSnapshot, 'plugins'>,
  filter: SourceFilter
): string {
  switch (filter.kind) {
    case 'all':
      return 'All'
    case 'plugins':
      return 'Plugin'
    case 'plugin':
      return `Plugin ${snapshot.plugins.find((p) => p.key === filter.key)?.name ?? filter.key}`
    default:
      return sourceLabel({ kind: filter.kind })
  }
}

/**
 * A section's line when the search or the filter leaves no row (D25, #71 D6): `No <noun> match
 * “<query>”.`, `No <noun> from <chip label>.` or both.
 */
export function noMatchText(
  noun: string,
  query: string,
  snapshot: Pick<AgentSetupSnapshot, 'plugins'>,
  filter: SourceFilter
): string {
  const from = filter.kind === 'all' ? '' : ` from ${filterLabel(snapshot, filter)}`
  const searched = query.trim()
  return `No ${noun}${from}${searched === '' ? '' : ` match “${searched}”`}.`
}

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

/** The skills, agents or commands matching `query` (D25) and `filter` (#71 D2). */
export function filterDefinitions(
  entries: readonly DefinitionEntry[],
  query: string,
  filter: SourceFilter = ALL_SOURCES
): DefinitionEntry[] {
  return entries.filter(
    (entry) => matchesSource(filter, entry.source) && matchesQuery(query, definitionFields(entry))
  )
}

const memoryMatches = (entry: MemoryEntry, query: string, filter: SourceFilter): boolean =>
  matchesSource(filter, entry.source) &&
  matchesQuery(query, [entry.label, entry.file, sourceLabel(entry.source)])

/**
 * The memory files matching `query` and `filter`, or holding an import that does, each with only
 * its matching imports (all of them when it matches itself).
 */
export function filterMemory(
  entries: readonly MemoryEntry[],
  query: string,
  filter: SourceFilter = ALL_SOURCES
): MemoryEntry[] {
  if (terms(query).length === 0 && filter.kind === 'all') return [...entries]
  const kept: MemoryEntry[] = []
  for (const entry of entries) {
    if (memoryMatches(entry, query, filter)) kept.push(entry)
    else {
      const imports = filterMemory(entry.imports, query, filter)
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
 * The hooks matching `query` and `filter`, grouped by event: known events in Claude Code's order,
 * unknown ones after them by name (D19); within an event, as read (Bikube's, local, project, user,
 * plugins).
 */
export function hookGroups(
  hooks: readonly HookEntry[],
  query: string,
  filter: SourceFilter = ALL_SOURCES
): HookGroup[] {
  const groups = new Map<string, HookEntry[]>()
  for (const hook of hooks) {
    if (!matchesSource(filter, hook.source) || !hookMatches(hook, query)) continue
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

/**
 * The permission rules matching `query` (D25) and `filter` (#71 D2), by precedence; `defaultMode`
 * is never filtered.
 */
export function permissionsView(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): PermissionsView {
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
    const shown = matchesSource(filter, source)
    const mode = permissions['defaultMode']
    if (view.defaultMode === null && typeof mode === 'string') {
      view.defaultMode = { value: mode, source, file: file.file }
    }
    for (const list of ['allow', 'ask', 'deny', 'additionalDirectories'] as const) {
      const rules = permissions[list]
      if (!Array.isArray(rules)) continue
      for (const rule of rules) {
        if (typeof rule !== 'string' || !shown) continue
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

/** One part of an Overview card's split (#71 D7): `3 User`, and the filter its button sets. */
export interface SplitPart {
  label: string
  filter: SourceFilter
}

const GROUP_FILTERS: Record<SourceGroup, SourceFilter> = {
  Project: { kind: 'project' },
  Local: { kind: 'local' },
  User: { kind: 'user' },
  Plugin: { kind: 'plugins' },
  Bikube: { kind: 'bikube' }
}

/** An Overview card's split as its parts (#71 D7), in `sourceSplit`'s order; `Plugin` sets All plugins. */
export function sourceSplitParts(summary: SectionSummary): SplitPart[] {
  return SOURCE_GROUPS.filter((group) => summary.bySource[group]).map((group) => ({
    label: `${summary.bySource[group]} ${group}`,
    filter: GROUP_FILTERS[group]
  }))
}

/** The sections Overview has a card for, in D12's order. */
export const OVERVIEW_SECTIONS: readonly FilterableSection[] = [
  'plugins',
  'mcp',
  'skills',
  'agents',
  'commands',
  'hooks',
  'memory',
  'permissions',
  'sandbox'
]

/** The sections the source filter applies to and that show its chip row (#71 D3). */
export type FilterableSection =
  | 'plugins'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'hooks'
  | 'memory'
  | 'permissions'
  | 'sandbox'
  | 'config'

export const FILTERABLE_SECTIONS: readonly FilterableSection[] = [
  'plugins',
  'mcp',
  'skills',
  'agents',
  'commands',
  'hooks',
  'memory',
  'permissions',
  'sandbox',
  'config'
]

export const isFilterableSection = (id: AgentSetupSectionId): id is FilterableSection =>
  (FILTERABLE_SECTIONS as readonly string[]).includes(id)

const pluginOrigin = (plugin: PluginEntry): RowOrigin => ({
  source: pluginSource(plugin),
  plugin: { key: plugin.key, name: plugin.name }
})

/** Section `id`'s rows matching `query` and `filter`, as where each comes from (#71 D2). */
function sectionOrigins(
  snapshot: AgentSetupSnapshot,
  id: FilterableSection,
  query: string,
  filter: SourceFilter
): RowOrigin[] {
  switch (id) {
    case 'skills':
    case 'agents':
    case 'commands':
      return filterDefinitions(snapshot[id], query, filter).map((e) => origin(e.source))
    case 'hooks':
      return hookGroups(snapshot.hooks, query, filter).flatMap((g) =>
        g.hooks.map((h) => origin(h.source))
      )
    case 'memory':
      return memoryRows(snapshot.memory)
        .filter((entry) => memoryMatches(entry, query, filter))
        .map((e) => origin(e.source))
    case 'permissions':
      return permissionRules(permissionsView(snapshot, query, filter)).map((r) => origin(r.source))
    case 'sandbox':
      return sandboxEntries(sandboxView(snapshot, query, filter)).map((e) => origin(e.source))
    case 'plugins':
      return filterPlugins(snapshot.plugins, query, filter).map(pluginOrigin)
    case 'mcp':
      return mcpServerRows(snapshot, query, filter).map((r) => origin(r.source))
    case 'config':
      return [
        ...configRows(snapshot, query, filter).map((r) => origin(r.source)),
        ...preferenceRows(snapshot, query, filter).map(() => origin({ kind: 'user' }))
      ]
  }
}

/**
 * Each section with rows: the count of its rows matching `query` and `filter` (#71 D6; all of them
 * for an empty query at All), D11's rows past a folder's limit counted only with no search and the
 * filter at All (#71 D2).
 */
export function sectionSummaries(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): Partial<Record<AgentSetupSectionId, SectionSummary>> {
  const unfiltered = terms(query).length === 0 && filter.kind === 'all'
  const result: Partial<Record<AgentSetupSectionId, SectionSummary>> = {}
  for (const id of FILTERABLE_SECTIONS) {
    const more =
      unfiltered && (id === 'skills' || id === 'agents' || id === 'commands')
        ? (snapshot.more[id] ?? 0)
        : 0
    result[id] = summary(
      sectionOrigins(snapshot, id, query, filter).map((r) => r.source),
      more
    )
  }
  return result
}

/** One plugin in the Plugin chip's menu (#71 D4), with its rows matching the search. */
export interface PluginChip {
  key: string
  name: string
  count: number
}

/** A section's chip row (#71 D3, D4): each chip's count is its rows matching the search. */
export interface SourceChips {
  /** The section's rows matching the search. */
  all: number
  /** The source chips shown, in order. */
  sources: { kind: SourceChipKind; label: string; count: number }[]
  /** The Plugin chip, when shown: its count (every plugin's rows) and its menu's plugins by name. */
  plugin: { count: number; plugins: PluginChip[] } | null
}

/** The sections with a chip row (#71 D3): the filterable ones and Overview. */
export type ChipSection = FilterableSection | 'overview'

/** Whether section `id` shows the chip row (#71 D3). */
export const showsSourceChips = (id: AgentSetupSectionId): id is ChipSection =>
  id === 'overview' || isFilterableSection(id)

/** Section `id`'s rows matching `query`, as where each comes from; Overview's are its cards' (#71 D3). */
const chipOrigins = (snapshot: AgentSetupSnapshot, id: ChipSection, query: string): RowOrigin[] =>
  id === 'overview'
    ? OVERVIEW_SECTIONS.flatMap((section) => sectionOrigins(snapshot, section, query, ALL_SOURCES))
    : sectionOrigins(snapshot, id, query, ALL_SOURCES)

/**
 * Section `id`'s chip row (#71 D3, D4), or null when it shows none: All, then the sources with a
 * row in the section (the search not applied, so chips stay while typing), each with its rows
 * matching `query`; Overview's are the sources across its cards' sections. A section whose rows
 * all come from one source shows none, unless the filter isn't All: then its chip is always there
 * (count 0 without rows), so it can be set back. The Plugin chip shows when a row belongs to a
 * plugin, an installed plugin's own row included (#71 D2, D4).
 */
export function sourceChips(
  snapshot: AgentSetupSnapshot,
  id: ChipSection,
  query: string,
  filter: SourceFilter
): SourceChips | null {
  const every = chipOrigins(snapshot, id, '')
  const matching = chipOrigins(snapshot, id, query)
  const count = (chip: SourceFilter): number =>
    matching.filter((row) => originMatches(chip, row)).length
  const kinds = SOURCE_CHIP_KINDS.filter(
    (kind) => filter.kind === kind || every.some((row) => row.source.kind === kind)
  )
  const fromPlugins = every.some((row) => row.plugin !== undefined)
  const pluginShown = fromPlugins || filter.kind === 'plugins' || filter.kind === 'plugin'
  if (filter.kind === 'all' && kinds.length + (fromPlugins ? 1 : 0) <= 1) return null
  let plugin: SourceChips['plugin'] = null
  if (pluginShown) {
    const names = new Map<string, string>()
    for (const row of every) if (row.plugin) names.set(row.plugin.key, row.plugin.name)
    const plugins = [...names]
      .map(([key, name]) => ({ key, name, count: count({ kind: 'plugin', key }) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1))
    plugin = { count: count({ kind: 'plugins' }), plugins }
  }
  return {
    all: matching.length,
    sources: kinds.map((kind) => ({ kind, label: sourceLabel({ kind }), count: count({ kind }) })),
    plugin
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

/** An installed plugin's source chip (D9): its install's scope, `User` when it names none. */
export function pluginSource(plugin: PluginEntry): EntrySource {
  return plugin.scope === 'project' || plugin.scope === 'local'
    ? { kind: plugin.scope }
    : { kind: 'user' }
}

/**
 * The installed plugins matching `query` (D25): by name, key, description, author or source; and
 * `filter` (#71 D2): by its install's scope, and every plugin's or its own plugin's filter.
 */
export function filterPlugins(
  plugins: readonly PluginEntry[],
  query: string,
  filter: SourceFilter = ALL_SOURCES
): PluginEntry[] {
  return plugins.filter(
    (plugin) =>
      originMatches(filter, pluginOrigin(plugin)) &&
      matchesQuery(query, [
        plugin.name,
        plugin.key,
        plugin.description,
        plugin.author,
        plugin.version,
        sourceLabel(pluginSource(plugin))
      ])
  )
}

/** One of a plugin's provides-counts (D15), linking to `section` with the filter at the plugin (#71 D8). */
export interface PluginProvides {
  section: AgentSetupSectionId
  label: string
}

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** What `plugin` provides (D15): `2 skills · 1 agent · 3 commands · hooks · 1 MCP server`, the empty ones left out. */
export function pluginProvides(
  snapshot: AgentSetupSnapshot,
  plugin: PluginEntry
): PluginProvides[] {
  const own = (entry: { source: EntrySource }): boolean =>
    entry.source.kind === 'plugin' && entry.source.key === plugin.key
  const provides: PluginProvides[] = []
  const skills = snapshot.skills.filter(own).length
  if (skills > 0) provides.push({ section: 'skills', label: counted(skills, 'skill', 'skills') })
  const agents = snapshot.agents.filter(own).length
  if (agents > 0) provides.push({ section: 'agents', label: counted(agents, 'agent', 'agents') })
  const commands = snapshot.commands.filter(own).length
  if (commands > 0) {
    provides.push({ section: 'commands', label: counted(commands, 'command', 'commands') })
  }
  if (snapshot.hooks.some(own)) provides.push({ section: 'hooks', label: 'hooks' })
  const servers = Object.keys(plugin.mcpServers ?? {}).length
  if (servers > 0) {
    provides.push({ section: 'mcp', label: counted(servers, 'MCP server', 'MCP servers') })
  }
  return provides
}

/** A known marketplace (D15), read-only. */
export interface MarketplaceRow {
  name: string
  /** `github: <repo>`, a git URL or a path. */
  source: string
  /** Its `lastUpdated` as the file holds it (an ISO date). */
  lastUpdated?: string
}

const marketplaceSource = (source: unknown): string => {
  if (!isObject(source)) return typeof source === 'string' ? source : ''
  const text = (key: string): string | undefined =>
    typeof source[key] === 'string' ? source[key] : undefined
  if (source['source'] === 'github' && text('repo')) return `github: ${text('repo')}`
  return text('url') ?? text('path') ?? text('repo') ?? ''
}

/**
 * The marketplaces of `known_marketplaces.json` matching `query` (D15, D25), in file order. They
 * have no source: none under any filter but All (#71 D2).
 */
export function marketplaceRows(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): MarketplaceRow[] {
  const value = snapshot.marketplaces.value
  if (!isObject(value) || filter.kind !== 'all') return []
  const rows: MarketplaceRow[] = []
  for (const [name, entry] of Object.entries(value)) {
    if (!isObject(entry)) continue
    const row: MarketplaceRow = { name, source: marketplaceSource(entry['source']) }
    if (typeof entry['lastUpdated'] === 'string') row.lastUpdated = entry['lastUpdated']
    if (matchesQuery(query, [row.name, row.source])) rows.push(row)
  }
  return rows
}

/**
 * An MCP server's state (D16): a project server's `on`, `off` or `not-approved` (its switch),
 * `enabled` for Local and User servers (no switch), a plugin's following its plugin.
 */
export type McpServerState = 'on' | 'off' | 'not-approved' | 'enabled' | 'plugin-on' | 'plugin-off'

const MCP_STATE_LABELS: Record<McpServerState, string> = {
  on: 'Enabled',
  off: 'Disabled',
  'not-approved': 'Not approved yet',
  enabled: 'Enabled',
  'plugin-on': 'Enabled',
  'plugin-off': 'Plugin off'
}

/** The text of an MCP server's state (D16). */
export const mcpStateLabel = (state: McpServerState): string => MCP_STATE_LABELS[state]

/** One MCP server (D16). Environment and header values are never kept, only their names. */
export interface McpServerRow {
  name: string
  /** `stdio`, `http` or `sse` (its `type`, else `http` for a URL and `stdio` for a command). */
  type: string
  /** Its command with its arguments, or its URL. */
  target: string
  envNames: string[]
  headerNames: string[]
  source: EntrySource
  /** The file it is set in. */
  file: string
  state: McpServerState
}

/** An argument as a shell line would quote it, for reading only (never run). */
const shellWord = (word: string): string =>
  word !== '' && /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`

function mcpServer(
  name: string,
  value: unknown,
  source: EntrySource,
  file: string,
  state: McpServerState
): McpServerRow {
  const server = isObject(value) ? value : {}
  const text = (key: string): string | undefined =>
    typeof server[key] === 'string' ? server[key] : undefined
  // The reader keeps only the names (D28); an object's keys are its names too.
  const names = (key: string): string[] => {
    const value = server[key]
    if (Array.isArray(value)) return value.filter((n): n is string => typeof n === 'string')
    return isObject(value) ? Object.keys(value) : []
  }
  const url = text('url')
  const command = text('command')
  const args = Array.isArray(server['args'])
    ? server['args'].filter((a): a is string => typeof a === 'string')
    : []
  return {
    name,
    type: text('type') ?? (url !== undefined && command === undefined ? 'http' : 'stdio'),
    target: url ?? (command !== undefined ? [command, ...args.map(shellWord)].join(' ') : ''),
    envNames: names('env'),
    headerNames: names('headers'),
    source,
    file,
    state
  }
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** A project server's state from the effective lists (D10, D16): disabled first, then approved. */
function projectServerState(settings: readonly SettingsFile[], name: string): McpServerState {
  if (stringList(effectiveSetting(settings, 'disabledMcpjsonServers')?.value).includes(name)) {
    return 'off'
  }
  if (
    stringList(effectiveSetting(settings, 'enabledMcpjsonServers')?.value).includes(name) ||
    effectiveSetting(settings, 'enableAllProjectMcpServers')?.value === true
  ) {
    return 'on'
  }
  return 'not-approved'
}

/**
 * Every MCP server matching `query` (D16, D25): `.mcp.json`'s (Project), `~/.claude.json`'s
 * project entry (Local) and its own (User), then each plugin's. Nothing is started or connected to.
 */
export function mcpServerRows(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): McpServerRow[] {
  const rows: McpServerRow[] = []
  const project = isObject(snapshot.mcpJson.value) ? snapshot.mcpJson.value['mcpServers'] : null
  if (isObject(project)) {
    for (const [name, value] of Object.entries(project)) {
      rows.push(
        mcpServer(
          name,
          value,
          { kind: 'project' },
          snapshot.mcpJson.file,
          projectServerState(snapshot.settings, name)
        )
      )
    }
  }
  const { claudeJson } = snapshot
  for (const [servers, kind] of [
    [claudeJson.localMcpServers, 'local'],
    [claudeJson.mcpServers, 'user']
  ] as const) {
    for (const [name, value] of Object.entries(servers)) {
      rows.push(mcpServer(name, value, { kind }, claudeJson.file, 'enabled'))
    }
  }
  for (const plugin of snapshot.plugins) {
    const source: EntrySource = { kind: 'plugin', plugin: plugin.name, key: plugin.key }
    for (const [name, value] of Object.entries(plugin.mcpServers ?? {})) {
      rows.push(
        mcpServer(
          name,
          value,
          source,
          `${plugin.installPath}/.mcp.json`,
          plugin.enabled ? 'plugin-on' : 'plugin-off'
        )
      )
    }
  }
  return rows.filter(
    (row) =>
      matchesSource(filter, row.source) &&
      matchesQuery(query, [
        row.name,
        row.type,
        row.target,
        ...row.envNames,
        ...row.headerNames,
        sourceLabel(row.source)
      ])
  )
}

/** Settings keys Config leaves to the sections that show them (D21). */
export const CONFIG_EXCLUDED_KEYS: readonly string[] = [
  'hooks',
  'permissions',
  'sandbox',
  'enabledPlugins',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'enableAllProjectMcpServers'
]

/** How a Config row's value can be changed (D22): a switch, a number field, or not at all. */
export type ConfigControl = 'switch' | 'number' | null

/** The control a settings value gets (D22): booleans a switch, finite numbers a number field. */
export function configControl(value: unknown): ConfigControl {
  if (typeof value === 'boolean') return 'switch'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  return null
}

/** A settings value as Config shows it: a string as it is, `env` as its names, else JSON. */
function configText(key: string, value: unknown): string {
  if (typeof value === 'string') return value
  // The reader reduced each file's `env` to its variables' names (D21, D28).
  if (key === 'env' && Array.isArray(value)) return value.join(', ')
  return JSON.stringify(value) ?? String(value)
}

/** A settings file that sets a Config key. */
export interface ConfigSetter {
  source: EntrySource
  file: string
  value: unknown
  /** The value as shown. */
  text: string
}

/** One Config row (D21): a settings key, its effective value and where it comes from. */
export interface ConfigRow extends ConfigSetter {
  key: string
  /** The lower files that set it too, by precedence: shown struck through. */
  overridden: ConfigSetter[]
  /** D22's control for the effective value. */
  control: ConfigControl
  /** The value comes from settings.local.json and has a control: Reset removes it there (D22). */
  resettable: boolean
}

const byKey = (a: { key: string }, b: { key: string }): number =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

/**
 * Config's rows matching `query` (D21, D25: key, value or source), by key: every top-level key the
 * settings files set but those other sections show, its value the first file's by precedence (D10).
 */
export function configRows(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): ConfigRow[] {
  const setters = new Map<string, ConfigSetter[]>()
  for (const file of snapshot.settings) {
    if (!file.value) continue
    for (const [key, value] of Object.entries(file.value)) {
      if (CONFIG_EXCLUDED_KEYS.includes(key)) continue
      const setter: ConfigSetter = {
        source: settingsSource(file),
        file: file.file,
        value,
        text: configText(key, value)
      }
      const list = setters.get(key)
      if (list) list.push(setter)
      else setters.set(key, [setter])
    }
  }
  const rows: ConfigRow[] = []
  for (const [key, [winner, ...overridden]] of setters) {
    const control = key === 'env' ? null : configControl(winner.value)
    const row: ConfigRow = {
      key,
      ...winner,
      overridden,
      control,
      // Only a value D22 lets the page change; the rest is read-only (D28).
      resettable: winner.source.kind === 'local' && control !== null
    }
    if (
      matchesSource(filter, row.source) &&
      matchesQuery(query, [key, row.text, sourceLabel(row.source)])
    ) {
      rows.push(row)
    }
  }
  return rows.sort(byKey)
}

/**
 * Whether a `~/.claude.json` key is a preference (D21), not a runtime counter or cache: none that
 * starts with `num`, `has`, `last`, `cached` or `first`, or ends with `At`, `Id`, `ID`, `Count` or
 * `Cache`.
 */
export const isPreferenceKey = (key: string): boolean =>
  !/^(num|has|last|cached|first)/.test(key) && !/(At|Id|ID|Count|Cache)$/.test(key)

/** One of Config's Preferences (D21): a `~/.claude.json` boolean or number, read-only. */
export interface PreferenceRow {
  key: string
  value: boolean | number
  text: string
  file: string
}

/** The Preferences matching `query` (D21, D25) and `filter` (#71 D2: they are User's), by key. */
export function preferenceRows(
  snapshot: AgentSetupSnapshot,
  query: string,
  filter: SourceFilter = ALL_SOURCES
): PreferenceRow[] {
  const { claudeJson } = snapshot
  if (!matchesSource(filter, { kind: 'user' })) return []
  return Object.entries(claudeJson.preferences)
    .filter(([key]) => isPreferenceKey(key))
    .map(([key, value]) => ({ key, value, text: String(value), file: claudeJson.file }))
    .filter((row) => matchesQuery(query, [row.key, row.text, 'User']))
    .sort(byKey)
}

/** A number as typed in a Config field (D22): a finite decimal number, else null. */
export function parseConfigNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}
