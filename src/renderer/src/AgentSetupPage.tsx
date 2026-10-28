import { Blocks, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AGENT_SETUP_GROUP_NAMES,
  AGENT_SETUP_GROUPS,
  AGENT_SETUP_SECTIONS,
  adjacentSection,
  type AgentSetupSectionId
} from '../../core/agent-setup-sections'
import {
  showsSourceChips,
  sectionSummaries,
  setupWarnings,
  sourceChips,
  type SourceFilter
} from '../../core/agent-setup-rows'
import type { AgentSetupSnapshot } from '../../core/agent-setup-snapshot'
import { keymapAction } from '../../core/keymap'
import type { Workspace } from '../../core/workspace-store'
import {
  refreshAgentSetup,
  refreshClaudeVersion,
  refreshStatsIfShown,
  useAgentSetupData,
  useAgentSetupRefresh
} from './agent-setup-data'
import SourceFilterChips from './AgentSetupFilter'
import { SectionIcon } from './agent-setup-icons'
import { useAgentSetupMemory } from './agent-setup-memory'
import {
  AgentsSection,
  CommandsSection,
  ConfigSection,
  FileActionsProvider,
  HooksSection,
  McpServersSection,
  MemorySection,
  OverviewSection,
  PermissionsSection,
  PluginsSection,
  SkillsSection,
  StatusSection
} from './AgentSetupSections'
import { StatsSection } from './AgentSetupStats'
import { registerCardViewActions } from './card-view-actions'
import { ICON, SMALL_ICON } from './icons'
import { currentKeymap } from './settings'
import Tooltip from './Tooltip'
import { dialogOpenIn, useViewWindow } from './view-window'

/** Below this page width the section list is a horizontal strip above the content (#68 D7). */
const NARROW_WIDTH = 640

/** What every section's view gets: the workspace, the last snapshot read and the search query (D25). */
export interface AgentSetupSectionProps {
  workspace: Workspace
  /** Everything main's last read found (D8); replaced by each read that changed something (D26). */
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

/**
 * Each section's view by id. A section without one shows its empty state; later slices add theirs
 * here.
 */
const SECTION_VIEWS: Partial<
  Record<AgentSetupSectionId, (props: AgentSetupSectionProps) => React.JSX.Element>
> = {
  overview: OverviewSection,
  status: StatusSection,
  plugins: PluginsSection,
  mcp: McpServersSection,
  skills: SkillsSection,
  agents: AgentsSection,
  commands: CommandsSection,
  hooks: HooksSection,
  memory: MemorySection,
  permissions: PermissionsSection,
  config: ConfigSection
}

/**
 * A workspace's Agent setup page (#68 D1, D5, D7): its header, a search box and Refresh above the
 * section list, and the section shown. Fills the main area in place of the board, as an open card
 * does; Back and the Back shortcut go back to the board, the page staying open in the sidebar as
 * a card does, until its close button closes it (D3). An SSH workspace's shows only a message (D6).
 */
function AgentSetupPage({
  workspace,
  onBack,
  onClose
}: {
  workspace: Workspace
  /** To the board, the page staying open in the sidebar as a card does. */
  onBack: () => void
  /** Its close button: out of the sidebar too. */
  onClose: () => void
}): React.JSX.Element {
  const view = useViewWindow()
  // The Back shortcut and the palette's Back row, as in an open card (D3); Close pane and Close
  // card close the page, as they close an open card's last pane or the card.
  const actions = useRef({ onBack, onClose })
  useEffect(() => {
    actions.current = { onBack, onClose }
  })
  useEffect(() => {
    const run = (action: string): void => {
      if (action === 'back') actions.current.onBack()
      else if (action === 'closePane' || action === 'closeCard') actions.current.onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      if (action !== 'back' && action !== 'closePane' && action !== 'closeCard') return
      if (dialogOpenIn(view)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) run(action)
    }
    view.addEventListener('keydown', onKeyDown, true)
    const unregister = registerCardViewActions(run)
    return () => {
      view.removeEventListener('keydown', onKeyDown, true)
      unregister()
    }
  }, [view])

  const ssh = workspace.host !== undefined
  return (
    <section className="agent-setup" data-testid="agent-setup" aria-label="Agent setup">
      <header className="agent-setup-header">
        <span className="agent-setup-header-icon" aria-hidden="true">
          <Blocks size={20} />
        </span>
        <div className="agent-setup-header-text">
          <h2 className="agent-setup-title">Agent setup</h2>
          {!ssh && (
            <p
              className="agent-setup-subtitle"
              data-testid="agent-setup-subtitle"
              title={workspace.directory}
            >
              Claude Code · <span className="agent-setup-folder">{workspace.directory}</span>
            </p>
          )}
          {!ssh && <SaveNotice folder={workspace.directory} />}
        </div>
        <Tooltip
          label="Close Agent setup"
          description="Takes it out of the sidebar; the toolbar opens it again"
          align="end"
        >
          <button
            type="button"
            className="icon-btn agent-setup-close"
            data-testid="agent-setup-close"
            aria-label="Close Agent setup"
            onClick={onClose}
          >
            <X {...ICON} />
          </button>
        </Tooltip>
      </header>
      {ssh ? (
        <p className="agent-setup-message" data-testid="agent-setup-ssh">
          Agent setup isn&apos;t available for SSH workspaces yet
        </p>
      ) : (
        <LocalAgentSetup workspace={workspace} />
      )}
    </section>
  )
}

/**
 * Under the header (D23): the last save's error line, else, once a switch was saved for the
 * folder in this run, that changes apply to Claude Code sessions started from now on.
 */
function SaveNotice({ folder }: { folder: string }): React.JSX.Element | null {
  const { saveError, saved } = useAgentSetupData(folder)
  return (
    <div role="status" className="agent-setup-notice-slot">
      {saveError !== null ? (
        <p
          className="agent-setup-notice agent-setup-notice-error"
          data-testid="agent-setup-save-error"
        >
          {saveError}
        </p>
      ) : saved ? (
        <p className="agent-setup-notice" data-testid="agent-setup-saved-note">
          Changes apply to Claude Code sessions started from now on
        </p>
      ) : null}
    </div>
  )
}

/**
 * The page's width in CSS pixels, followed as the window or sidebar resizes. The page shows only
 * in the main window (#68 out of scope: card windows), so the global observer is its window's.
 */
function usePageWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function LocalAgentSetup({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const id = useId()
  const { section, setSection, query, setQuery, filter, setFilter } = useAgentSetupMemory(
    workspace.id
  )
  const body = useRef<HTMLDivElement>(null)
  const width = usePageWidth(body)
  const narrow = width !== null && width < NARROW_WIDTH
  const current = AGENT_SETUP_SECTIONS.find((s) => s.id === section)!
  const SectionView = SECTION_VIEWS[section]
  const panelId = `${id}-panel`
  // Read on open, every 3 s while focused, on focus and on Refresh (D26).
  const folder = workspace.directory
  useAgentSetupRefresh(folder)
  // Claude Code's version: on open and Refresh only, never on the periodic refresh (D13, D26).
  useEffect(() => {
    void refreshClaudeVersion()
  }, [])
  const { snapshot, failed, expanded } = useAgentSetupData(folder)
  const summaries = useMemo(
    () => (snapshot ? sectionSummaries(snapshot, query, filter) : null),
    [snapshot, query, filter]
  )
  const counts = useMemo(() => {
    if (!summaries) return undefined
    const result: Partial<Record<AgentSetupSectionId, number>> = {}
    for (const [key, summary] of Object.entries(summaries)) {
      result[key as AgentSetupSectionId] = summary.count
    }
    return result
  }, [summaries])
  // Sections with no row matching the search and the filter are dimmed (D25, #71 D6); Stats and
  // Status are not filtered.
  const dimmed = useMemo(() => {
    if (!summaries || (query.trim() === '' && filter.kind === 'all')) return undefined
    const result = new Set<AgentSetupSectionId>()
    for (const [key, summary] of Object.entries(summaries)) {
      if (summary.count === 0) result.add(key as AgentSetupSectionId)
    }
    return result
  }, [summaries, query, filter])
  // The chip row of a filterable section and Overview (#71 D3).
  const chips = useMemo(
    () =>
      snapshot && showsSourceChips(section) ? sourceChips(snapshot, section, query, filter) : null,
    [snapshot, section, query, filter]
  )
  const warnings = useMemo(
    () => (snapshot ? new Set(setupWarnings(snapshot).map((w) => w.section)) : undefined),
    [snapshot]
  )
  return (
    <div
      ref={body}
      className={narrow ? 'agent-setup-body agent-setup-narrow' : 'agent-setup-body'}
      data-testid="agent-setup-body"
      data-narrow={narrow}
    >
      <div className="agent-setup-side">
        <div className="agent-setup-tools">
          <label className="agent-setup-search">
            <Search {...SMALL_ICON} />
            <input
              type="search"
              className="agent-setup-search-input"
              data-testid="agent-setup-search"
              aria-label="Search agent setup"
              placeholder="Search"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc clears the search (D25); with nothing to clear it does nothing here.
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-small agent-setup-refresh"
            data-testid="agent-setup-refresh"
            title="Read the files again"
            onClick={() => {
              void refreshAgentSetup(folder)
              void refreshClaudeVersion()
              // Stats, once shown in this run: never on the periodic refresh (D14, D26).
              refreshStatsIfShown(workspace)
            }}
          >
            <RefreshCw {...SMALL_ICON} />
            {/* A narrow page shows the icon alone; the name stays for screen readers. */}
            <span className={narrow ? 'visually-hidden' : undefined}>Refresh</span>
          </button>
        </div>
        <SectionList
          section={section}
          onSelect={setSection}
          orientation={narrow ? 'horizontal' : 'vertical'}
          tabId={(key) => `${id}-tab-${key}`}
          panelId={panelId}
          counts={counts}
          warnings={warnings}
          dimmed={dimmed}
        />
      </div>
      <div
        className="agent-setup-panel"
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${section}`}
        data-testid="agent-setup-panel"
        data-section={section}
      >
        <div className="agent-setup-panel-head">
          <SectionIcon id={section} />
          <div className="agent-setup-panel-head-text">
            <h3 className="agent-setup-panel-title">{current.label}</h3>
            <p className="agent-setup-panel-hint">{current.hint}</p>
          </div>
        </div>
        {chips && snapshot && (
          <SourceFilterChips
            chips={chips}
            filter={filter}
            snapshot={snapshot}
            onFilter={setFilter}
          />
        )}
        {section === 'stats' ? (
          // Stats read the transcripts on their own, not the snapshot (D14).
          <StatsSection workspace={workspace} />
        ) : SectionView && snapshot ? (
          <FileActionsProvider key={folder} folder={folder} snapshot={snapshot}>
            <SectionView
              workspace={workspace}
              snapshot={snapshot}
              query={query}
              filter={filter}
              onShowSection={setSection}
              onFilter={setFilter}
              expanded={expanded}
            />
          </FileActionsProvider>
        ) : SectionView && failed ? (
          <p className="agent-setup-empty" data-testid="agent-setup-failed">
            Couldn&apos;t read the workspace folder. Check that it still exists, then press Refresh.
          </p>
        ) : SectionView ? (
          <p className="agent-setup-empty" data-testid="agent-setup-loading">
            Reading the setup…
          </p>
        ) : (
          <p className="agent-setup-empty" data-testid="agent-setup-empty">
            Nothing to show here yet.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The section list (D7): a tablist in its four groups, vertical beside the content or a horizontal
 * strip above it on a narrow page, the arrow keys of its orientation moving between sections. Each
 * item shows its count and a warning dot when given one.
 */
export function SectionList({
  section,
  onSelect,
  orientation,
  tabId,
  panelId,
  counts,
  warnings,
  dimmed
}: {
  section: AgentSetupSectionId
  onSelect: (id: AgentSetupSectionId) => void
  orientation: 'vertical' | 'horizontal'
  tabId: (id: AgentSetupSectionId) => string
  panelId: string
  /** Each section's number of entries, where it has one. */
  counts?: Partial<Record<AgentSetupSectionId, number>>
  /** The sections with an entry that has a warning (D24). */
  warnings?: ReadonlySet<AgentSetupSectionId>
  /** The sections with no row matching the search and the filter (D25, #71 D6), shown dimmed. */
  dimmed?: ReadonlySet<AgentSetupSectionId>
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const [previous, next] =
      orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
    if (event.key !== previous && event.key !== next) return
    event.preventDefault()
    const target = adjacentSection(section, event.key === next ? 1 : -1)
    onSelect(target)
    list.current?.querySelector<HTMLElement>(`[data-section="${target}"]`)?.focus()
  }
  return (
    <div
      ref={list}
      className="agent-setup-nav"
      role="tablist"
      aria-label="Agent setup sections"
      aria-orientation={orientation}
      data-testid="agent-setup-sections"
      data-searching={dimmed !== undefined}
      onKeyDown={onKeyDown}
    >
      {AGENT_SETUP_GROUPS.map((group, index) => [
        // The group's name in the vertical list, a gap in the narrow strip.
        <span key={`group-${index}`} className="agent-setup-group-name" aria-hidden="true">
          {orientation === 'vertical' ? AGENT_SETUP_GROUP_NAMES[index] : null}
        </span>,
        ...group.map(({ id, label }) => {
          const count = counts?.[id]
          const warning = warnings?.has(id) === true
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={tabId(id)}
              className="agent-setup-tab"
              data-section={id}
              data-dimmed={dimmed?.has(id) === true}
              data-testid={`agent-setup-section-${id}`}
              aria-selected={section === id}
              aria-controls={panelId}
              tabIndex={section === id ? 0 : -1}
              onClick={() => onSelect(id)}
            >
              <SectionIcon id={id} small />
              <span className="agent-setup-tab-label">{label}</span>
              {warning && (
                <span
                  className="agent-setup-tab-warning"
                  data-testid="agent-setup-section-warning"
                  title="Has warnings"
                  aria-label="Has warnings"
                />
              )}
              {count !== undefined && (
                <span className="agent-setup-tab-count" data-testid="agent-setup-section-count">
                  {count}
                </span>
              )}
            </button>
          )
        })
      ])}
    </div>
  )
}

export default AgentSetupPage
