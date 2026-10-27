import { ChevronRight } from 'lucide-react'
import type { AgentSetupSectionId } from '../../core/agent-setup-sections'
import { AGENT_SETUP_SECTIONS } from '../../core/agent-setup-sections'
import {
  fileLabel,
  filterDefinitions,
  filterMemory,
  isPluginOff,
  sectionSummaries,
  setupWarnings,
  sourceSplit
} from '../../core/agent-setup-rows'
import {
  sourceLabel,
  type AgentSetupSnapshot,
  type DefinitionEntry,
  type EntrySource,
  type MemoryEntry
} from '../../core/agent-setup-snapshot'
import { toggleExpanded } from './agent-setup-data'
import { SMALL_ICON } from './icons'

/**
 * The Agent setup page's sections built so far (#68 D12, D17, D18, D24): Overview, Skills, Agents,
 * Commands and Memory, each showing the rows of the snapshot that match the search (D25).
 */

/** What every section's view gets. */
export interface SectionViewProps {
  snapshot: AgentSetupSnapshot
  /** The search box's text; a section shows only its rows matching it. */
  query: string
  /** Shows another section, as a click on it in the list (Overview's cards, D12). */
  onShowSection: (id: AgentSetupSectionId) => void
  /** The memory rows expanded (D17), kept across reads. */
  expanded: ReadonlySet<string>
}

/**
 * Where a file-backed row's Open file and Reveal buttons go (D27). They come with S6; until then
 * the slot holds nothing.
 */
function FileActions({ file }: { file: string }): React.JSX.Element | null {
  void file
  return null
}

function SourceChip({ source }: { source: EntrySource }): React.JSX.Element {
  return (
    <span className="agent-setup-chip" data-testid="agent-setup-source">
      {sourceLabel(source)}
    </span>
  )
}

function Warnings({ warnings }: { warnings: readonly string[] }): React.JSX.Element | null {
  if (warnings.length === 0) return null
  return (
    <span className="agent-setup-row-warnings">
      {warnings.map((message) => (
        <span key={message} className="agent-setup-warning" data-testid="agent-setup-row-warning">
          ⚠ {message}
        </span>
      ))}
    </span>
  )
}

const label = (id: AgentSetupSectionId): string =>
  AGENT_SETUP_SECTIONS.find((s) => s.id === id)!.label

/** The sections Overview has a card for, in D12's order; those with rows so far. */
const OVERVIEW_CARDS: readonly AgentSetupSectionId[] = [
  'plugins',
  'mcp',
  'skills',
  'agents',
  'commands',
  'hooks',
  'memory',
  'permissions'
]

/** Overview (D12): a card per section with its count by source, then every warning. */
export function OverviewSection({
  snapshot,
  query,
  onShowSection
}: SectionViewProps): React.JSX.Element {
  const summaries = sectionSummaries(snapshot, query)
  const warnings = setupWarnings(snapshot)
  return (
    <div className="agent-setup-overview">
      <div className="agent-setup-cards">
        {OVERVIEW_CARDS.map((id) => {
          const summary = summaries[id]
          if (!summary) return null
          const split = sourceSplit(summary)
          return (
            <button
              key={id}
              type="button"
              className="agent-setup-card"
              data-testid={`agent-setup-overview-${id}`}
              data-dimmed={query.trim() !== '' && summary.count === 0}
              onClick={() => onShowSection(id)}
            >
              <span className="agent-setup-card-head">
                <span className="agent-setup-card-label">{label(id)}</span>
                <span className="agent-setup-card-count">{summary.count}</span>
              </span>
              <span className="agent-setup-card-split" data-testid="agent-setup-overview-split">
                {split || 'None'}
              </span>
            </button>
          )
        })}
      </div>
      <h4 className="agent-setup-subheading">Warnings</h4>
      {warnings.length === 0 ? (
        <p className="agent-setup-empty" data-testid="agent-setup-no-warnings">
          No problems found
        </p>
      ) : (
        <ul className="agent-setup-rows" data-testid="agent-setup-warnings">
          {warnings.map((warning, i) => (
            <li
              key={`${warning.file}\n${warning.message}\n${i}`}
              className="agent-setup-row"
              data-testid="agent-setup-warning-item"
            >
              <div className="agent-setup-row-main">
                <button
                  type="button"
                  className="agent-setup-link"
                  onClick={() => onShowSection(warning.section)}
                  title={`Show ${label(warning.section)}`}
                >
                  {warning.entry}
                </button>
                <span className="agent-setup-row-file" title={warning.file}>
                  {fileLabel(snapshot, warning.file)}
                </span>
                <FileActions file={warning.file} />
              </div>
              <Warnings warnings={[warning.message]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type DefinitionKind = 'skills' | 'agents' | 'commands'

const NOUNS: Record<DefinitionKind, string> = {
  skills: 'skills',
  agents: 'agents',
  commands: 'commands'
}

const EMPTY_HINTS: Record<DefinitionKind, string> = {
  skills:
    'Add one as .claude/skills/<name>/SKILL.md in the workspace folder or in ~/.claude/skills.',
  agents: 'Add one as a .md file in .claude/agents in the workspace folder or in ~/.claude/agents.',
  commands:
    'Add one as a .md file in .claude/commands in the workspace folder or in ~/.claude/commands.'
}

function DefinitionRow({
  entry,
  snapshot
}: {
  entry: DefinitionEntry
  snapshot: AgentSetupSnapshot
}): React.JSX.Element {
  const off = isPluginOff(snapshot, entry)
  return (
    <li
      className={off ? 'agent-setup-row agent-setup-row-off' : 'agent-setup-row'}
      data-testid="agent-setup-row"
      data-plugin-off={off}
    >
      <div className="agent-setup-row-main">
        <span className="agent-setup-row-name" data-testid="agent-setup-row-name">
          {entry.name}
        </span>
        {entry.argumentHint && (
          <span className="agent-setup-row-hint" title="Arguments">
            {entry.argumentHint}
          </span>
        )}
        <span className="agent-setup-row-chips">
          {entry.model && <span className="agent-setup-chip">{entry.model}</span>}
          {entry.tools?.map((tool) => (
            <span key={tool} className="agent-setup-chip">
              {tool}
            </span>
          ))}
          <SourceChip source={entry.source} />
          {off && (
            <span className="agent-setup-chip" data-testid="agent-setup-plugin-off">
              Plugin off
            </span>
          )}
        </span>
        <FileActions file={entry.file} />
      </div>
      {entry.description && (
        <p className="agent-setup-row-description" title={entry.description}>
          {entry.description}
        </p>
      )}
      <Warnings warnings={entry.warnings} />
    </li>
  )
}

function DefinitionSection({
  kind,
  snapshot,
  query
}: SectionViewProps & { kind: DefinitionKind }): React.JSX.Element {
  const all = snapshot[kind]
  const rows = filterDefinitions(all, query)
  const more = query.trim() === '' ? (snapshot.more[kind] ?? 0) : 0
  if (all.length === 0 && more === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-empty">
        No {NOUNS[kind]} found. {EMPTY_HINTS[kind]}
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-no-match">
        No {NOUNS[kind]} match “{query.trim()}”.
      </p>
    )
  }
  return (
    <ul className="agent-setup-rows" data-testid={`agent-setup-${kind}`}>
      {rows.map((entry) => (
        <DefinitionRow key={entry.file} entry={entry} snapshot={snapshot} />
      ))}
      {more > 0 && (
        <li className="agent-setup-row agent-setup-row-more" data-testid="agent-setup-more">
          … {more} more
        </li>
      )}
    </ul>
  )
}

export const SkillsSection = (props: SectionViewProps): React.JSX.Element => (
  <DefinitionSection {...props} kind="skills" />
)
export const AgentsSection = (props: SectionViewProps): React.JSX.Element => (
  <DefinitionSection {...props} kind="agents" />
)
export const CommandsSection = (props: SectionViewProps): React.JSX.Element => (
  <DefinitionSection {...props} kind="commands" />
)

const sizeText = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`

function MemoryRow({
  entry,
  rowKey,
  folder,
  expanded
}: {
  entry: MemoryEntry
  rowKey: string
  folder: string
  expanded: ReadonlySet<string>
}): React.JSX.Element {
  const open = expanded.has(rowKey)
  const canExpand = !entry.missing && entry.head !== ''
  return (
    <li className="agent-setup-row" data-testid="agent-setup-memory-row" data-label={entry.label}>
      <div className="agent-setup-row-main">
        {canExpand ? (
          <button
            type="button"
            className="agent-setup-expand"
            aria-expanded={open}
            onClick={() => toggleExpanded(folder, rowKey)}
          >
            <ChevronRight {...SMALL_ICON} className="agent-setup-expand-icon" />
            <span className="agent-setup-row-name" data-testid="agent-setup-row-name">
              {entry.label}
            </span>
          </button>
        ) : (
          <span
            className="agent-setup-row-name agent-setup-row-name-flat"
            data-testid="agent-setup-row-name"
          >
            {entry.label}
          </span>
        )}
        {!entry.missing && (
          <span className="agent-setup-row-meta">
            {sizeText(entry.size)} · {entry.lines} {entry.lines === 1 ? 'line' : 'lines'}
          </span>
        )}
        <span className="agent-setup-row-chips">
          <SourceChip source={entry.source} />
        </span>
        {!entry.missing && <FileActions file={entry.file} />}
      </div>
      <Warnings warnings={entry.warnings} />
      {open && canExpand && (
        <pre className="agent-setup-preview" data-testid="agent-setup-memory-preview">
          {entry.head}
        </pre>
      )}
      {entry.imports.length > 0 && (
        <ul className="agent-setup-rows agent-setup-imports">
          {entry.imports.map((child) => (
            <MemoryRow
              key={child.file}
              entry={child}
              rowKey={`${rowKey}\n${child.file}`}
              folder={folder}
              expanded={expanded}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Memory (D17): the memory files in load order, their imports nested, expandable. */
export function MemorySection({ snapshot, query, expanded }: SectionViewProps): React.JSX.Element {
  const rows = filterMemory(snapshot.memory, query)
  if (snapshot.memory.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-empty">
        No memory files found. Claude Code reads CLAUDE.md in the workspace folder and its parents,
        and ~/.claude/CLAUDE.md.
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-no-match">
        No memory files match “{query.trim()}”.
      </p>
    )
  }
  return (
    <ul className="agent-setup-rows" data-testid="agent-setup-memory">
      {rows.map((entry) => (
        <MemoryRow
          key={entry.file}
          entry={entry}
          rowKey={entry.file}
          folder={snapshot.folder}
          expanded={expanded}
        />
      ))}
    </ul>
  )
}
