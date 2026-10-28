import { useCallback, useState } from 'react'
import { ALL_SOURCES, type SourceFilter } from '../../core/agent-setup-rows'
import {
  FIRST_SECTION,
  toggleCollapsedGroup,
  type AgentSetupSectionId
} from '../../core/agent-setup-sections'

/**
 * Each workspace's Agent setup page as it was left, for this run of the app: the section shown
 * (#68 D7, Overview the first time), the search query (D25), the source filter (#71 D1, D10:
 * All the first time) and the groups collapsed (#71 D9: every group open the first time). Runtime
 * only: never saved or synced.
 */
interface PageMemory {
  section: AgentSetupSectionId
  query: string
  filter: SourceFilter
  /** The collapsed groups' keys, `collapsedGroupKey`'s. */
  collapsed: ReadonlySet<string>
}

const NONE_COLLAPSED: ReadonlySet<string> = new Set()

const memory = new Map<string, PageMemory>()

function remembered(workspaceId: string): PageMemory {
  return (
    memory.get(workspaceId) ?? {
      section: FIRST_SECTION,
      query: '',
      filter: ALL_SOURCES,
      collapsed: NONE_COLLAPSED
    }
  )
}

/**
 * Workspace `workspaceId`'s section, query, filter and collapsed groups, kept for the next time its
 * page shows.
 */
export function useAgentSetupMemory(workspaceId: string): {
  section: AgentSetupSectionId
  setSection: (section: AgentSetupSectionId) => void
  query: string
  setQuery: (query: string) => void
  filter: SourceFilter
  setFilter: (filter: SourceFilter) => void
  collapsed: ReadonlySet<string>
  toggleGroup: (section: AgentSetupSectionId, name: string) => void
} {
  const [state, setState] = useState(() => remembered(workspaceId))
  const update = useCallback(
    (change: Partial<PageMemory>) => {
      const next = { ...remembered(workspaceId), ...change }
      memory.set(workspaceId, next)
      setState(next)
    },
    [workspaceId]
  )
  return {
    section: state.section,
    setSection: useCallback((section) => update({ section }), [update]),
    query: state.query,
    setQuery: useCallback((query) => update({ query }), [update]),
    filter: state.filter,
    setFilter: useCallback((filter) => update({ filter }), [update]),
    collapsed: state.collapsed,
    toggleGroup: useCallback(
      (section, name) =>
        update({
          collapsed: toggleCollapsedGroup(remembered(workspaceId).collapsed, section, name)
        }),
      [update, workspaceId]
    )
  }
}
