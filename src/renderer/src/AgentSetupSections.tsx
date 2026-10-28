import { ChevronRight, FolderOpen, RotateCcw, SquarePen, X } from 'lucide-react'
import { createContext, Fragment, useContext, useId, useMemo, useRef, useState } from 'react'
import type { AgentSetupSectionId } from '../../core/agent-setup-sections'
import { AGENT_SETUP_SECTIONS } from '../../core/agent-setup-sections'
import {
  accountText,
  configRows,
  effectiveSetting,
  fileLabel,
  filterDefinitions,
  filterLabel,
  filterMemory,
  filterPlugins,
  hookGroups,
  isPluginOff,
  marketplaceRows,
  mcpServerRows,
  mcpStateLabel,
  noMatchText,
  parseConfigNumber,
  permissionsView,
  pluginProvides,
  pluginSource,
  preferenceRows,
  sectionSummaries,
  settingsFileStates,
  setupWarnings,
  OVERVIEW_SECTIONS,
  sourceSplitParts,
  type SourceFilter
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
import type { ConfigRow, McpServerRow } from '../../core/agent-setup-rows'
import { isOpenNote, listedFileErrorLine } from '../../core/open-result'
import type { Workspace } from '../../core/workspace-store'
import {
  saveConfig,
  saveSwitch,
  switchKey,
  toggleExpanded,
  useAgentSetupData,
  useClaudeVersion
} from './agent-setup-data'
import { SectionIcon } from './agent-setup-icons'
import { SMALL_ICON } from './icons'
import { useSettings } from './settings'

/**
 * The Agent setup page's sections built so far (#68 D12, D13, D15–D22, D24): Overview, Status,
 * Plugins, MCP servers, Skills, Agents, Commands, Hooks, Memory, Permissions and Config, each showing the
 * rows of the snapshot that match the search (D25; Status is not filtered).
 */

/** What every section's view gets. */
export interface SectionViewProps {
  /** The workspace shown: its `directory` keys the page's data, as the renderer asked main for it. */
  workspace: Workspace
  snapshot: AgentSetupSnapshot
  /** The search box's text; a section shows only its rows matching it. */
  query: string
  /** The page's source filter (#71 D1): a section shows only its rows from it. */
  filter: SourceFilter
  /** Shows another section, as a click on it in the list (Overview's cards, D12). */
  onShowSection: (id: AgentSetupSectionId) => void
  /** Sets the page's source filter (Overview's split parts, a plugin's provides-counts; #71 D7, D8). */
  onFilter: (filter: SourceFilter) => void
  /** The memory rows expanded (D17), kept across reads. */
  expanded: ReadonlySet<string>
}

/** What a row's Open file and Reveal need (D27, D28): the folder main read and what it listed. */
interface FileActionsScope {
  folder: string
  /** The files main's last read listed: only these get the buttons, as only these main opens. */
  paths: ReadonlySet<string>
  open: (file: string) => void
  reveal: (file: string) => void
}

const FileActionsContext = createContext<FileActionsScope | null>(null)

/**
 * Gives the rows inside it their Open file and Reveal (D27) for the workspace folder `folder`, and
 * shows the last open's or reveal's failure as the Files tab does (`Couldn't open <file name>:
 * <reason>`), a refused one as `file not found`.
 */
export function FileActionsProvider({
  folder,
  snapshot,
  children
}: {
  folder: string
  snapshot: AgentSetupSnapshot
  children: React.ReactNode
}): React.JSX.Element {
  /** The last action's error line, or its note when the file opened with the default app (#70 D3). */
  const [error, setError] = useState<{ text: string; note: boolean } | null>(null)
  /** Only the latest open's result shows. */
  const opens = useRef(0)
  const paths = useMemo(() => new Set(snapshot.paths), [snapshot.paths])
  const scope = useMemo<FileActionsScope>(
    () => ({
      folder,
      paths,
      open: (file) => {
        const at = ++opens.current
        setError(null)
        void window.bikube.agentSetup.openFile(folder, file).then((result) => {
          if (at !== opens.current) return
          const text = listedFileErrorLine(file, result)
          setError(text === null ? null : { text, note: isOpenNote(result) })
        })
      },
      reveal: (file) => {
        const at = ++opens.current
        setError(null)
        void window.bikube.agentSetup.reveal(folder, file).then((revealed) => {
          if (at !== opens.current) return
          const text = listedFileErrorLine(
            file,
            revealed ? { ok: true } : { ok: false, reason: 'refused' }
          )
          setError(text === null ? null : { text, note: false })
        })
      }
    }),
    [folder, paths]
  )
  return (
    <FileActionsContext.Provider value={scope}>
      {error !== null && (
        <div
          className={error.note ? 'files-error files-note' : 'files-error'}
          role={error.note ? 'status' : 'alert'}
          data-testid="agent-setup-open-error"
        >
          <span className="files-error-text">{error.text}</span>
          <button
            type="button"
            className="icon-btn"
            data-testid="agent-setup-open-error-dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setError(null)}
          >
            <X {...SMALL_ICON} />
          </button>
        </div>
      )}
      {children}
    </FileActionsContext.Provider>
  )
}

/**
 * A file-backed row's Open file and Reveal buttons (D27), shown on the row's hover and focus.
 * Nothing for a file main's last read didn't list (Bikube's own, a missing one, D28).
 */
function FileActions({ file }: { file: string }): React.JSX.Element | null {
  const scope = useContext(FileActionsContext)
  if (!scope?.paths.has(file)) return null
  const name = file.slice(file.lastIndexOf('/') + 1)
  return (
    <span className="agent-setup-file-actions" data-testid="agent-setup-file-actions">
      <button
        type="button"
        className="icon-btn agent-setup-file-action"
        data-testid="agent-setup-open-file"
        aria-label="Open file"
        title={`Open ${name}`}
        onClick={() => scope.open(file)}
      >
        <SquarePen {...SMALL_ICON} />
      </button>
      <button
        type="button"
        className="icon-btn agent-setup-file-action"
        data-testid="agent-setup-reveal"
        aria-label="Reveal"
        title={`Show ${name} in the file manager`}
        onClick={() => scope.reveal(file)}
      >
        <FolderOpen {...SMALL_ICON} />
      </button>
    </span>
  )
}

function SourceChip({ source }: { source: EntrySource }): React.JSX.Element {
  return (
    <span className="agent-setup-chip" data-source={source.kind} data-testid="agent-setup-source">
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

/**
 * Overview (D12): a card per section with its count by source, then every warning. A click on a
 * card shows its section, the filter unchanged; each part of its split is its own button setting
 * the filter to that source as well (#71 D7). The card's name and count are one button, so the
 * split's buttons aren't nested in another.
 */
export function OverviewSection({
  snapshot,
  query,
  filter,
  onShowSection,
  onFilter
}: SectionViewProps): React.JSX.Element {
  const summaries = sectionSummaries(snapshot, query, filter)
  const narrowed = query.trim() !== '' || filter.kind !== 'all'
  const warnings = setupWarnings(snapshot)
  return (
    <div className="agent-setup-overview">
      <div className="agent-setup-cards">
        {OVERVIEW_SECTIONS.map((id) => {
          const summary = summaries[id]
          if (!summary) return null
          const parts = sourceSplitParts(summary)
          return (
            <div
              key={id}
              className="agent-setup-card"
              data-testid={`agent-setup-overview-${id}`}
              data-dimmed={narrowed && summary.count === 0}
              onClick={() => onShowSection(id)}
            >
              <button
                type="button"
                className="agent-setup-card-main"
                onClick={(e) => {
                  e.stopPropagation()
                  onShowSection(id)
                }}
              >
                <span className="agent-setup-card-head">
                  <SectionIcon id={id} />
                  <span className="agent-setup-card-label">{label(id)}</span>
                </span>
                <span className="agent-setup-card-count">{summary.count}</span>
              </button>
              <span className="agent-setup-card-split" data-testid="agent-setup-overview-split">
                {parts.length === 0
                  ? 'None'
                  : parts.map((part, i) => (
                      <Fragment key={part.label}>
                        {i > 0 && <span aria-hidden="true">{' · '}</span>}
                        <button
                          type="button"
                          className="agent-setup-link agent-setup-link-quiet agent-setup-card-part"
                          title={`Show ${label(id)} from ${filterLabel(snapshot, part.filter)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onFilter(part.filter)
                            onShowSection(id)
                          }}
                        >
                          {part.label}
                        </button>
                      </Fragment>
                    ))}
              </span>
            </div>
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
        <FileActions file={entry.file} />
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
  query,
  filter
}: SectionViewProps & { kind: DefinitionKind }): React.JSX.Element {
  const all = snapshot[kind]
  const rows = filterDefinitions(all, query, filter)
  // Rows past the folder's limit only with no search and the filter at All (#71 D2).
  const more = query.trim() === '' && filter.kind === 'all' ? (snapshot.more[kind] ?? 0) : 0
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
        {noMatchText(NOUNS[kind], query, snapshot, filter)}
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
        {!entry.missing && <FileActions file={entry.file} />}
        <span className="agent-setup-row-chips">
          <SourceChip source={entry.source} />
        </span>
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
export function MemorySection({
  workspace,
  snapshot,
  query,
  filter,
  expanded
}: SectionViewProps): React.JSX.Element {
  const rows = filterMemory(snapshot.memory, query, filter)
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
        {noMatchText('memory files', query, snapshot, filter)}
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
          folder={workspace.directory}
          expanded={expanded}
        />
      ))}
    </ul>
  )
}

/** Hooks (D19): every hook command by event, Bikube's with its chip and no Open file. */
export function HooksSection({ snapshot, query, filter }: SectionViewProps): React.JSX.Element {
  const groups = hookGroups(snapshot.hooks, query, filter)
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
        {noMatchText('hooks', query, snapshot, filter)}
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
        {hook.file !== undefined && <FileActions file={hook.file} />}
        <span className="agent-setup-row-chips">
          <SourceChip source={hook.source} />
          {off && (
            <span className="agent-setup-chip" data-testid="agent-setup-plugin-off">
              Plugin off
            </span>
          )}
        </span>
        {/* Bikube's own hooks have no file to open (D27). */}
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
export function PermissionsSection({
  snapshot,
  query,
  filter
}: SectionViewProps): React.JSX.Element {
  const view = permissionsView(snapshot, query, filter)
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
                      <FileActions file={rule.file} />
                      <span className="agent-setup-row-chips">
                        <SourceChip source={rule.source} />
                      </span>
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
                  {!bikube && file.state !== 'missing' && <FileActions file={file.file} />}
                  <span className="agent-setup-row-chips">
                    <SourceChip source={file.source} />
                  </span>
                  {/* Bikube's own file has no Open file (D27); a missing one has nothing to open. */}
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
  folder,
  plugin,
  snapshot,
  onShowSection,
  onFilter
}: {
  /** The workspace folder, as the page's data is kept by. */
  folder: string
  plugin: PluginEntry
  snapshot: AgentSetupSnapshot
  onShowSection: SectionViewProps['onShowSection']
  onFilter: SectionViewProps['onFilter']
}): React.JSX.Element {
  const { saving } = useAgentSetupData(folder)
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
        {snapshot.paths.includes(manifest) && <FileActions file={manifest} />}
        <span className="agent-setup-row-chips">
          <SourceChip source={pluginSource(plugin)} />
        </span>
        <span className="agent-setup-control-slot agent-setup-control-slot-switch">
          <Switch
            label={`Use ${plugin.key} in this workspace`}
            checked={asked ?? plugin.enabled}
            testId="agent-setup-plugin-switch"
            onChange={(enabled) =>
              void saveSwitch(folder, { kind: 'plugin', key: plugin.key, enabled })
            }
          />
        </span>
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
              {i > 0 && <span aria-hidden="true">{'\u00a0·\u00a0'}</span>}
              <button
                type="button"
                className="agent-setup-link agent-setup-link-quiet"
                title={`Show ${label(item.section)} from ${plugin.name}`}
                onClick={() => {
                  // The section with the filter at this plugin, the search left as it is (#71 D8).
                  onFilter({ kind: 'plugin', key: plugin.key })
                  onShowSection(item.section)
                }}
              >
                {item.label}
              </button>
            </span>
          ))}
          {plugin.author && (
            <span className="agent-setup-row-meta">
              {provides.length > 0 ? '\u00a0· ' : ''}by {plugin.author}
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
  workspace,
  snapshot,
  query,
  filter,
  onShowSection,
  onFilter
}: SectionViewProps): React.JSX.Element {
  const plugins = filterPlugins(snapshot.plugins, query, filter)
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
            {noMatchText('plugins', query, snapshot, filter)}
          </p>
        ) : (
          <ul className="agent-setup-rows">
            {plugins.map((plugin) => (
              <PluginRow
                key={plugin.key}
                folder={workspace.directory}
                plugin={plugin}
                snapshot={snapshot}
                onShowSection={onShowSection}
                onFilter={onFilter}
              />
            ))}
          </ul>
        )}
      </section>
      {/* Marketplaces have no source: shown only with the filter at All (#71 D2). */}
      {filter.kind === 'all' && (
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
      )}
    </div>
  )
}

function McpServerItem({
  folder,
  server,
  snapshot
}: {
  /** The workspace folder, as the page's data is kept by. */
  folder: string
  server: McpServerRow
  snapshot: AgentSetupSnapshot
}): React.JSX.Element {
  const { saving } = useAgentSetupData(folder)
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
        {snapshot.paths.includes(server.file) && <FileActions file={server.file} />}
        <span className="agent-setup-row-chips">
          <SourceChip source={server.source} />
          <span className="agent-setup-chip" data-state={state} data-testid="agent-setup-mcp-state">
            {mcpStateLabel(state)}
          </span>
        </span>
        {/* Kept empty without a switch, so every row's chips line up. */}
        <span className="agent-setup-control-slot agent-setup-control-slot-switch">
          {project && (
            <Switch
              label={`Use MCP server ${server.name} in this workspace`}
              checked={state === 'on'}
              testId="agent-setup-mcp-switch"
              onChange={(enabled) =>
                void saveSwitch(folder, { kind: 'mcpServer', name: server.name, enabled })
              }
            />
          )}
        </span>
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
export function McpServersSection({
  workspace,
  snapshot,
  query,
  filter
}: SectionViewProps): React.JSX.Element {
  const all = mcpServerRows(snapshot, '')
  const rows = mcpServerRows(snapshot, query, filter)
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
        {noMatchText('MCP servers', query, snapshot, filter)}
      </p>
    )
  }
  return (
    <ul className="agent-setup-rows" data-testid="agent-setup-mcp">
      {rows.map((server) => (
        <McpServerItem
          key={`${server.source.kind}\n${server.file}\n${server.name}`}
          folder={workspace.directory}
          server={server}
          snapshot={snapshot}
        />
      ))}
    </ul>
  )
}

/** What a Config number field reads for anything but a finite number (D22). */
const NUMBER_ERROR = 'Enter a number'

/**
 * A Config number (D22): saved on Enter or blur when it changed; anything but a finite number is
 * refused (`invalid`, the row shows `Enter a number`) and nothing is written. Esc puts the value
 * read back.
 */
function ConfigNumber({
  folder,
  settingKey,
  value,
  draft,
  onDraft,
  invalid,
  onInvalid,
  errorId
}: {
  folder: string
  settingKey: string
  value: number
  /** What the field holds: the row keeps it, replaced when a read brings a new value. */
  draft: string
  onDraft: (draft: string) => void
  invalid: boolean
  onInvalid: (invalid: boolean) => void
  errorId: string
}): React.JSX.Element {
  // The number being saved, so a blur right after Enter saves it once.
  const pending = useRef<number | null>(null)
  const commit = (): void => {
    const next = parseConfigNumber(draft)
    if (next === null) {
      onInvalid(true)
      return
    }
    onInvalid(false)
    if (next === value || next === pending.current) return
    pending.current = next
    void saveConfig(folder, { kind: 'set', key: settingKey, value: next }).then((saved) => {
      pending.current = null
      // A failed save puts the value read back; its error line is under the header.
      if (!saved) onDraft(String(value))
    })
  }
  return (
    <input
      className="settings-input agent-setup-config-number"
      data-testid="agent-setup-config-number"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={settingKey}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid ? errorId : undefined}
      value={draft}
      onChange={(e) => {
        onDraft(e.target.value)
        onInvalid(false)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape' && (draft !== String(value) || invalid)) {
          e.preventDefault()
          e.stopPropagation()
          onDraft(String(value))
          onInvalid(false)
        }
      }}
    />
  )
}

/**
 * One Config row (D21, D22): the key, its effective value (a switch for a boolean, a number field
 * for a number, else the value read-only), the file it comes from, the lower files that set it
 * struck through, and Reset when settings.local.json sets it.
 */
function ConfigItem({
  folder,
  row,
  snapshot
}: {
  /** The workspace folder, as the page's data is kept by. */
  folder: string
  row: ConfigRow
  snapshot: AgentSetupSnapshot
}): React.JSX.Element {
  const { saving } = useAgentSetupData(folder)
  const asked = saving.get(switchKey({ kind: 'config', key: row.key }))
  const errorId = useId()
  const [draft, setDraft] = useState(String(row.value))
  const [invalid, setInvalid] = useState(false)
  // A read with a new value replaces what the number field shows.
  const [seen, setSeen] = useState(row.value)
  if (!Object.is(seen, row.value)) {
    setSeen(row.value)
    setDraft(String(row.value))
    setInvalid(false)
  }
  return (
    <li className="agent-setup-row" data-testid="agent-setup-config-row" data-key={row.key}>
      <div className="agent-setup-row-main">
        <span
          className="agent-setup-row-name agent-setup-row-mono"
          title={row.key}
          data-testid="agent-setup-row-name"
        >
          {row.key}
        </span>
        {row.control === null && (
          <code
            className="agent-setup-config-value"
            title={row.text}
            data-testid="agent-setup-config-value"
          >
            {row.text}
          </code>
        )}
        <FileActions file={row.file} />
        <span className="agent-setup-row-chips">
          <SourceChip source={row.source} />
          {row.overridden.map((setter) => (
            <s
              key={setter.file}
              className="agent-setup-chip agent-setup-chip-overridden"
              title={`${sourceLabel(setter.source)} (${fileLabel(snapshot, setter.file)}): ${setter.text}, overridden by ${sourceLabel(row.source)}`}
              data-testid="agent-setup-config-overridden"
            >
              {sourceLabel(setter.source)}: {setter.text}
            </s>
          ))}
        </span>
        {/* Kept empty for a read-only key, so every row's chips line up. */}
        <span className="agent-setup-control-slot">
          {row.resettable && (
            <button
              type="button"
              className="icon-btn agent-setup-config-reset"
              data-testid="agent-setup-config-reset"
              title="Reset: remove it from settings.local.json"
              aria-label={`Reset ${row.key}`}
              onClick={() => void saveConfig(folder, { kind: 'remove', key: row.key })}
            >
              <RotateCcw {...SMALL_ICON} />
            </button>
          )}
          {row.control === 'switch' && (
            <Switch
              label={row.key}
              checked={asked ?? row.value === true}
              testId="agent-setup-config-switch"
              onChange={(value) => void saveConfig(folder, { kind: 'set', key: row.key, value })}
            />
          )}
          {row.control === 'number' && typeof row.value === 'number' && (
            <ConfigNumber
              folder={folder}
              settingKey={row.key}
              value={row.value}
              draft={draft}
              onDraft={setDraft}
              invalid={invalid}
              onInvalid={setInvalid}
              errorId={errorId}
            />
          )}
        </span>
      </div>
      {invalid && (
        <p className="field-error" id={errorId} role="alert" data-testid="agent-setup-config-error">
          {NUMBER_ERROR}
        </p>
      )}
    </li>
  )
}

/**
 * Config (D21, D22): every top-level settings key other sections don't show, with its effective
 * value and where it comes from, booleans and numbers changed in place in settings.local.json;
 * then `~/.claude.json`'s Preferences, read-only.
 */
export function ConfigSection({
  workspace,
  snapshot,
  query,
  filter
}: SectionViewProps): React.JSX.Element {
  const all = configRows(snapshot, '')
  const rows = configRows(snapshot, query, filter)
  const allPreferences = preferenceRows(snapshot, '')
  const preferences = preferenceRows(snapshot, query, filter)
  const narrowed = query.trim() !== '' || filter.kind !== 'all'
  return (
    <div className="agent-setup-groups" data-testid="agent-setup-config">
      <section className="agent-setup-group">
        <h4 className="agent-setup-subheading">Settings</h4>
        {all.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-empty">
            No settings set. Claude Code reads them from .claude/settings.json and
            .claude/settings.local.json in the workspace folder, and ~/.claude/settings.json.
          </p>
        ) : rows.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-no-match">
            {noMatchText('settings', query, snapshot, filter)}
          </p>
        ) : (
          <ul className="agent-setup-rows">
            {rows.map((row) => (
              <ConfigItem
                key={row.key}
                folder={workspace.directory}
                row={row}
                snapshot={snapshot}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="agent-setup-group">
        <h4 className="agent-setup-subheading">Preferences</h4>
        {preferences.length === 0 ? (
          <p className="agent-setup-empty" data-testid="agent-setup-preferences-empty">
            {narrowed && allPreferences.length > 0
              ? noMatchText('preferences', query, snapshot, filter)
              : 'No preferences in ~/.claude.json. Claude Code saves them there from /config.'}
          </p>
        ) : (
          <ul className="agent-setup-rows" data-testid="agent-setup-preferences">
            {preferences.map((row) => (
              <li key={row.key} className="agent-setup-row" data-testid="agent-setup-preference">
                <div className="agent-setup-row-main">
                  <span
                    className="agent-setup-row-name agent-setup-row-mono"
                    title={row.key}
                    data-testid="agent-setup-row-name"
                  >
                    {row.key}
                  </span>
                  <code className="agent-setup-config-value" data-testid="agent-setup-config-value">
                    {row.text}
                  </code>
                  <FileActions file={row.file} />
                  <span className="agent-setup-row-chips">
                    <SourceChip source={{ kind: 'user' }} />
                  </span>
                  <span className="agent-setup-control-slot" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
