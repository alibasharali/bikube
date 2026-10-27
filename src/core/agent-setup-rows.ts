/**
 * The Agent setup page's rows from a snapshot (#68 D12, D18, D24, D25): each section's matching
 * rows and count split by source, the search, the warnings list and a plugin entry's off state.
 * Plain TS with no Node or DOM imports: the renderer runs it.
 *
 * Sections with rows are those `sectionSummaries` returns; later slices add theirs (Plugins, MCP
 * servers, Hooks, Permissions) there, and their warnings to `setupWarnings`.
 */

import type { AgentSetupSectionId } from './agent-setup-sections'
import {
  sourceLabel,
  type AgentSetupSnapshot,
  type DefinitionEntry,
  type EntrySource,
  type MemoryEntry
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
    memory: summary(
      memoryRows(snapshot.memory)
        .filter((entry) => memoryMatches(entry, query))
        .map((e) => e.source)
    )
  }
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
