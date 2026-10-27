import { ChevronRight } from 'lucide-react'
import type { AgentSetupSectionId } from '../../core/agent-setup-sections'
import { AGENT_SETUP_SECTIONS } from '../../core/agent-setup-sections'
import {
  accountText,
  effectiveSetting,
  fileLabel,
  filterDefinitions,
  filterMemory,
  filterPlugins,
  hookGroups,
  isPluginOff,
  marketplaceRows,
  mcpServerRows,
  mcpStateLabel,
  permissionsView,
  pluginProvides,
  pluginQuery,
  pluginSource,
  sectionSummaries,
  settingsFileStates,
  setupWarnings,
  sourceSplit
} from '../../core/agent-setup-rows'
import {
  sourceLabel,
  type AgentSetupSnapshot,
  type DefinitionEntry,
  type EntrySource,
  type HookEntry,
  type JsonFileState,
  type MemoryEntry,
  type PluginEntry
} from '../../core/agent-setup-snapshot'
import type { McpServerRow } from '../../core/agent-setup-rows'
import {
  saveSwitch,
  switchKey,
  toggleExpanded,
  useAgentSetupData,
  useClaudeVersion
} from './agent-setup-data'
import { SMALL_ICON } from './icons'
import { useSettings } from './settings'

/**
 * The Agent setup page's sections built so far (#68 D12, D13, D15–D20, D24): Overview, Status,
 * Plugins, MCP servers, Skills, Agents, Commands, Hooks, Memory and Permissions, each showing the
 * rows of the snapshot that match the search (D25; Status is not filtered).
 */

/** What every section's view gets. */
export interface SectionViewProps {
  snapshot: AgentSetupSnapshot
  /** The search box's text; a section shows only its rows matching it. */
  query: string
  /** Shows another section, as a click on it in the list (Overview's cards, D12). */
  onShowSection: (id: AgentSetupSectionId) => void
  /** Puts `query` in the search box (a plugin's provides-counts, D15). */
  onSearch: (query: string) => void
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

/** Hooks (D19): every hook command by event, Bikube's with its chip and no Open file. */
export function HooksSection({ snapshot, query }: SectionViewProps): React.JSX.Element {
  const groups = hookGroups(snapshot.hooks, query)
  if (snapshot.hooks.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-empty">
        No hooks found. Add them under &quot;hooks&quot; in .claude/settings.json in the workspace
        folder or in ~/.claude/settings.json.
      </p>
    )
  }
  if (groups.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-no-match">
        No hooks match “{query.trim()}”.
      </p>
    )
  }
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-hooks">
      {groups.map((group) => (
        <section
          key={group.event}
          className="agent-setup-group"
          data-testid="agent-setup-hook-group"
        >
          <h4 className="agent-setup-subheading">{group.event}</h4>
          <ul className="agent-setup-rows">
            {group.hooks.map((hook, i) => (
              <HookRow
                key={`${hook.file ?? 'bikube'}\n${hook.command}\n${i}`}
                hook={hook}
                snapshot={snapshot}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function HookRow({
  hook,
  snapshot
}: {
  hook: HookEntry
  snapshot: AgentSetupSnapshot
}): React.JSX.Element {
  const off = isPluginOff(snapshot, hook)
  return (
    <li
      className={off ? 'agent-setup-row agent-setup-row-off' : 'agent-setup-row'}
      data-testid="agent-setup-row"
      data-plugin-off={off}
    >
      <div className="agent-setup-row-main">
        <span className="agent-setup-chip" data-testid="agent-setup-hook-matcher" title="Matcher">
          {hook.matcher ?? 'All'}
        </span>
        {hook.timeout !== undefined && (
          <span className="agent-setup-row-meta">Timeout {hook.timeout} s</span>
        )}
        <span className="agent-setup-row-chips">
          <SourceChip source={hook.source} />
          {off && (
            <span className="agent-setup-chip" data-testid="agent-setup-plugin-off">
              Plugin off
            </span>
          )}
        </span>
        {/* Bikube's own hooks have no file to open (D27). */}
        {hook.file !== undefined && <FileActions file={hook.file} />}
      </div>
      <code
        className="agent-setup-row-command"
        title={hook.command}
        data-testid="agent-setup-hook-command"
      >
        {hook.command}
      </code>
      <Warnings warnings={hook.warnings} />
    </li>
  )
}

const PERMISSION_LISTS = [
  ['allow', 'Allow'],
  ['ask', 'Ask'],
  ['deny', 'Deny'],
  ['additionalDirectories', 'Additional directories']
] as const

/** Permissions (D20), read-only: the effective default mode, then every source's rules. */
export function PermissionsSection({ snapshot, query }: SectionViewProps): React.JSX.Element {
  const view = permissionsView(snapshot, query)
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-permissions">
      <dl className="agent-setup-facts">
        <div className="agent-setup-fact" data-testid="agent-setup-default-mode">
          <dt>Default mode</dt>
          <dd>
            {view.defaultMode ? (
              <>
                <span className="agent-setup-fact-value">{view.defaultMode.value}</span>
                <SourceChip source={view.defaultMode.source} />
              </>
            ) : (
              'Default'
            )}
          </dd>
        </div>
      </dl>
      {PERMISSION_LISTS.map(([list, title]) => {
        const testId = `agent-setup-permissions-${list === 'additionalDirectories' ? 'directories' : list}`
        const rules = view[list]
        return (
          <section key={list} className="agent-setup-group">
            <h4 className="agent-setup-subheading">{title}</h4>
            {rules.length === 0 ? (
              <p className="agent-setup-empty" data-testid={testId}>
                None
              </p>
            ) : (
              <ul className="agent-setup-rows" data-testid={testId}>
                {rules.map((rule, i) => (
                  <li
                    key={`${rule.file}\n${rule.rule}\n${i}`}
                    className="agent-setup-row"
                    data-testid="agent-setup-row"
                  >
                    <div className="agent-setup-row-main">
                      <code
                        className="agent-setup-row-rule"
                        title={rule.rule}
                        data-testid="agent-setup-permission-rule"
                      >
                        {rule.rule}
                      </code>
                      <span className="agent-setup-row-chips">
                        <SourceChip source={rule.source} />
                      </span>
                      <FileActions file={rule.file} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

const STATE_LABELS: Record<JsonFileState, string> = {
  found: 'Found',
  missing: 'Missing',
  invalid: 'Invalid'
}

/** Status' Claude Code value (D13): its version and path, `Not installed`, or the check's state. */
function ClaudeCodeValue(): React.JSX.Element {
  const { reading, result } = useClaudeVersion()
  if (result === undefined) return <>{reading ? 'Checking…' : 'Not checked yet'}</>
  if (result === null) {
    return (
      <>Couldn&apos;t check: your login shell didn&apos;t answer. Press Refresh to try again.</>
    )
  }
  if (!result.installed) return <>Not installed</>
  return (
    <>
      <span className="agent-setup-fact-value">{result.version ?? 'Unknown version'}</span>
      <span className="agent-setup-row-file" title={result.path}>
        {result.path}
      </span>
    </>
  )
}

/** A setting's effective string value with its source chip (D10), else `Default`. */
function EffectiveValue({
  snapshot,
  setting
}: {
  snapshot: AgentSetupSnapshot
  setting: string
}): React.JSX.Element {
  const effective = effectiveSetting(snapshot.settings, setting)
  if (!effective || typeof effective.value !== 'string') return <>Default</>
  return (
    <>
      <span className="agent-setup-fact-value">{effective.value}</span>
      <SourceChip source={{ kind: effective.file.scope }} />
    </>
  )
}

/** Status (D13): Claude Code, the account, the model and output style, and every settings file. */
export function StatusSection({ snapshot }: SectionViewProps): React.JSX.Element {
  const settings = useSettings()
  const facts: [string, string, React.ReactNode][] = [
    ['claude', 'Claude Code', <ClaudeCodeValue key="claude" />],
    ['account', 'Account', accountText(snapshot)],
    ['model', 'Model', <EffectiveValue key="model" snapshot={snapshot} setting="model" />],
    [
      'output-style',
      'Output style',
      <EffectiveValue key="output-style" snapshot={snapshot} setting="outputStyle" />
    ],
    [
      'bikube',
      'Bikube hooks',
      `Active in Claude Code cards · Claude Code status: ${settings.claudeStatus ? 'On' : 'Off'}`
    ]
  ]
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-status">
      <dl className="agent-setup-facts">
        {facts.map(([id, name, value]) => (
          <div key={id} className="agent-setup-fact" data-testid={`agent-setup-status-${id}`}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="agent-setup-group">
        <h4 className="agent-setup-subheading">Settings files</h4>
        <ul className="agent-setup-rows">
          {settingsFileStates(snapshot).map((file) => {
            const bikube = file.source.kind === 'bikube'
            const name = bikube ? baseName(file.file) : fileLabel(snapshot, file.file)
            return (
              <li key={file.file} className="agent-setup-row" data-testid="agent-setup-status-file">
                <div className="agent-setup-row-main">
                  <span
                    className="agent-setup-row-name agent-setup-row-mono"
                    title={file.file}
                    data-testid="agent-setup-status-file-name"
                  >
                    {name}
                  </span>
                  <span
                    className="agent-setup-chip"
                    data-state={file.state}
                    data-testid="agent-setup-status-file-state"
                  >
                    {STATE_LABELS[file.state]}
                  </span>
                  <span className="agent-setup-row-chips">
                    <SourceChip source={file.source} />
                  </span>
                  {/* Bikube's own file has no Open file (D27); a missing one has nothing to open. */}
                  {!bikube && file.state !== 'missing' && <FileActions file={file.file} />}
                </div>
                {file.error !== undefined && <Warnings warnings={[file.error]} />}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** An on/off switch as Settings' (D7), labelled for screen readers by `label`. */
function Switch({
  label,
  checked,
  testId,
  onChange
}: {
  label: string
  checked: boolean
  testId: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <span className="switch agent-setup-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        title={label}
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </span>
  )
}

function PluginRow({
  plugin,
  snapshot,
  onShowSection,
  onSearch
}: {
  plugin: PluginEntry
  snapshot: AgentSetupSnapshot
  onShowSection: SectionViewProps['onShowSection']
  onSearch: SectionViewProps['onSearch']
}): React.JSX.Element {
  const { saving } = useAgentSetupData(snapshot.folder)
  const asked = saving.get(switchKey({ kind: 'plugin', key: plugin.key }))
  const provides = pluginProvides(snapshot, plugin)
  const manifest = `${plugin.installPath}/.claude-plugin/plugin.json`
  return (
    <li className="agent-setup-row" data-testid="agent-setup-plugin" data-key={plugin.key}>
      <div className="agent-setup-row-main">
        <span className="agent-setup-row-name" data-testid="agent-setup-row-name">
          {plugin.name}
        </span>
        <span className="agent-setup-row-meta" title="Marketplace">
          @{plugin.marketplace}
        </span>
        {plugin.version && <span className="agent-setup-row-meta">v{plugin.version}</span>}
        <span className="agent-setup-row-chips">
          <SourceChip source={pluginSource(plugin)} />
        </span>
        <Switch
          label={`Use ${plugin.key} in this workspace`}
          checked={asked ?? plugin.enabled}
          testId="agent-setup-plugin-switch"
          onChange={(enabled) =>
            void saveSwitch(snapshot.folder, { kind: 'plugin', key: plugin.key, enabled })
          }
        />
        {snapshot.paths.includes(manifest) && <FileActions file={manifest} />}
      </div>
      {plugin.description && (
        <p className="agent-setup-row-description" title={plugin.description}>
          {plugin.description}
        </p>
      )}
      {(plugin.author || provides.length > 0) && (
        <div className="agent-setup-row-provides" data-testid="agent-setup-plugin-provides">
          {provides.map((item, i) => (
            <span key={item.section}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <button
                type="button"
                className="agent-setup-link agent-setup-link-quiet"
                title={`Show ${label(item.section)} from ${plugin.name}`}
                onClick={() => {
                  onSearch(pluginQuery(plugin))
                  onShowSection(item.section)
                }}
              >
                {item.label}
              </button>
            </span>
          ))}
          {plugin.author && (
            <span className="agent-setup-row-meta">
              {provides.length > 0 ? ' · ' : ''}by {plugin.author}
            </span>
          )}
        </div>
      )}
      <Warnings warnings={plugin.warnings} />
    </li>
  )
}

/** A marketplace's last update as a local date, or the text as the file holds it. */
const updatedText = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

/**
 * Plugins (D15): the installed plugins listed for the workspace, each with its switch for this
 * workspace and what it provides, then the known marketplaces, read-only.
 */
export function PluginsSection({
  snapshot,
  query,
  onShowSection,
  onSearch
}: SectionViewProps): React.JSX.Element {
  const plugins = filterPlugins(snapshot.plugins, query)
  const marketplaces = marketplaceRows(snapshot, query)
  const searching = query.trim() !== ''
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-plugins">
      <section className="agent-setup-group">
        <h4 className="agent-setup-subheading">Installed</h4>
        {snapshot.plugins.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-empty">
            No plugins installed. Install them in Claude Code with /plugin.
          </p>
        ) : plugins.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-no-match">
            No plugins match “{query.trim()}”.
          </p>
        ) : (
          <ul className="agent-setup-rows">
            {plugins.map((plugin) => (
              <PluginRow
                key={plugin.key}
                plugin={plugin}
                snapshot={snapshot}
                onShowSection={onShowSection}
                onSearch={onSearch}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="agent-setup-group">
        <h4 className="agent-setup-subheading">Marketplaces</h4>
        {marketplaces.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-marketplaces-empty">
            {searching
              ? `No marketplaces match “${query.trim()}”.`
              : 'No marketplaces known. Add one in Claude Code with /plugin marketplace add.'}
          </p>
        ) : (
          <ul className="agent-setup-rows" data-testid="agent-setup-marketplaces">
            {marketplaces.map((market) => (
              <li
                key={market.name}
                className="agent-setup-row"
                data-testid="agent-setup-marketplace"
              >
                <div className="agent-setup-row-main">
                  <span className="agent-setup-row-name" data-testid="agent-setup-row-name">
                    {market.name}
                  </span>
                  <span className="agent-setup-row-file" title={market.source}>
                    {market.source}
                  </span>
                  {market.lastUpdated && (
                    <span className="agent-setup-row-meta agent-setup-row-end">
                      Updated {updatedText(market.lastUpdated)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function McpServerItem({
  server,
  snapshot
}: {
  server: McpServerRow
  snapshot: AgentSetupSnapshot
}): React.JSX.Element {
  const { saving } = useAgentSetupData(snapshot.folder)
  const project = server.source.kind === 'project'
  const asked = project
    ? saving.get(switchKey({ kind: 'mcpServer', name: server.name }))
    : undefined
  // While a switch is saved the state reads as asked for; the read after it confirms it.
  const state = asked === undefined ? server.state : asked ? 'on' : 'off'
  const off = state === 'plugin-off'
  const variables: [string, string[]][] = [
    ['Environment', server.envNames],
    ['Headers', server.headerNames]
  ]
  return (
    <li
      className={off ? 'agent-setup-row agent-setup-row-off' : 'agent-setup-row'}
      data-testid="agent-setup-mcp-server"
      data-name={server.name}
      data-plugin-off={off}
    >
      <div className="agent-setup-row-main">
        <span className="agent-setup-row-name" data-testid="agent-setup-row-name">
          {server.name}
        </span>
        <span className="agent-setup-chip" data-testid="agent-setup-mcp-type" title="Type">
          {server.type}
        </span>
        <span className="agent-setup-row-chips">
          <SourceChip source={server.source} />
          <span className="agent-setup-chip" data-state={state} data-testid="agent-setup-mcp-state">
            {mcpStateLabel(state)}
          </span>
        </span>
        {project && (
          <Switch
            label={`Use MCP server ${server.name} in this workspace`}
            checked={state === 'on'}
            testId="agent-setup-mcp-switch"
            onChange={(enabled) =>
              void saveSwitch(snapshot.folder, { kind: 'mcpServer', name: server.name, enabled })
            }
          />
        )}
        {snapshot.paths.includes(server.file) && <FileActions file={server.file} />}
      </div>
      {server.target && (
        <code
          className="agent-setup-row-command"
          title={server.target}
          data-testid="agent-setup-mcp-target"
        >
          {server.target}
        </code>
      )}
      {variables.map(
        ([name, names]) =>
          names.length > 0 && (
            <span key={name} className="agent-setup-row-meta" data-testid="agent-setup-mcp-names">
              {name}: {names.join(', ')}
            </span>
          )
      )}
    </li>
  )
}

/**
 * MCP servers (D16): the project's, Local and User servers from ~/.claude.json and the plugins',
 * with a switch for each project server. No server is started or connected to; environment and
 * header values are never shown.
 */
export function McpServersSection({ snapshot, query }: SectionViewProps): React.JSX.Element {
  const all = mcpServerRows(snapshot, '')
  const rows = mcpServerRows(snapshot, query)
  if (all.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-empty">
        No MCP servers found. Add them to .mcp.json in the workspace folder, or with claude mcp add.
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="agent-setup-empty" data-testid="agent-setup-no-match">
        No MCP servers match “{query.trim()}”.
      </p>
    )
  }
  return (
    <ul className="agent-setup-rows" data-testid="agent-setup-mcp">
      {rows.map((server) => (
        <McpServerItem
          key={`${server.source.kind}\n${server.file}\n${server.name}`}
          server={server}
          snapshot={snapshot}
        />
      ))}
    </ul>
  )
}
