import { RefreshCw, Search } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  AGENT_SETUP_GROUPS,
  AGENT_SETUP_SECTIONS,
  adjacentSection,
  type AgentSetupSectionId
} from '../../core/agent-setup-sections'
import { keymapAction } from '../../core/keymap'
import type { Workspace } from '../../core/workspace-store'
import { useAgentSetupMemory } from './agent-setup-memory'
import { registerCardViewActions } from './card-view-actions'
import { SMALL_ICON } from './icons'
import { currentKeymap } from './settings'
import { dialogOpenIn, useViewWindow } from './view-window'

/** Below this page width the section list is a horizontal strip above the content (#68 D7). */
const NARROW_WIDTH = 640

/** What every section's view gets: the workspace and the search query (D25). */
export interface AgentSetupSectionProps {
  workspace: Workspace
  /** The search box's text; a section shows only its rows matching it. */
  query: string
  /** Shows another section, as a click on it in the list (Overview's cards, D12). */
  onShowSection: (id: AgentSetupSectionId) => void
}

/**
 * Each section's view by id. A section without one shows its empty state; later slices add theirs
 * here.
 */
const SECTION_VIEWS: Partial<
  Record<AgentSetupSectionId, (props: AgentSetupSectionProps) => React.JSX.Element>
> = {}

/**
 * A workspace's Agent setup page (#68 D1, D5, D7): its header, a search box and Refresh above the
 * section list, and the section shown. Fills the main area in place of the board, as an open card
 * does; Back and the Back shortcut go back to the board (D3). An SSH workspace's shows only a
 * message (D6).
 */
function AgentSetupPage({
  workspace,
  onBack
}: {
  workspace: Workspace
  onBack: () => void
}): React.JSX.Element {
  const view = useViewWindow()
  // The Back shortcut and the palette's Back row, as in an open card (D3).
  const back = useRef(onBack)
  useEffect(() => {
    back.current = onBack
  })
  useEffect(() => {
    const run = (action: string): void => {
      if (action === 'back') back.current()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (keymapAction(event, currentKeymap()) !== 'back' || dialogOpenIn(view)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) run('back')
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
        <h2 className="agent-setup-title">Agent setup</h2>
        {!ssh && (
          <p
            className="agent-setup-subtitle"
            data-testid="agent-setup-subtitle"
            title={workspace.directory}
          >
            Claude Code · {workspace.directory}
          </p>
        )}
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
  const { section, setSection, query, setQuery } = useAgentSetupMemory(workspace.id)
  const body = useRef<HTMLDivElement>(null)
  const width = usePageWidth(body)
  const narrow = width !== null && width < NARROW_WIDTH
  const current = AGENT_SETUP_SECTIONS.find((s) => s.id === section)!
  const SectionView = SECTION_VIEWS[section]
  const panelId = `${id}-panel`
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
        <h3 className="agent-setup-panel-title">{current.label}</h3>
        {SectionView ? (
          <SectionView workspace={workspace} query={query} onShowSection={setSection} />
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
  warnings
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
      onKeyDown={onKeyDown}
    >
      {AGENT_SETUP_GROUPS.map((group, index) => [
        index > 0 && <span key={`rule-${index}`} className="agent-setup-rule" aria-hidden="true" />,
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
              data-testid={`agent-setup-section-${id}`}
              aria-selected={section === id}
              aria-controls={panelId}
              tabIndex={section === id ? 0 : -1}
              onClick={() => onSelect(id)}
            >
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
