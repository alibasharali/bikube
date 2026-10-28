import { useCallback, useState } from 'react'
import { ALL_SOURCES, type SourceFilter } from '../../core/agent-setup-rows'
import { FIRST_SECTION, type AgentSetupSectionId } from '../../core/agent-setup-sections'

/**
 * Each workspace's Agent setup page as it was left, for this run of the app: the section shown
 * (#68 D7, Overview the first time), the search query (D25) and the source filter (#71 D1, D10:
 * All the first time). Runtime only: never saved or synced.
 */
interface PageMemory {
  section: AgentSetupSectionId
  query: string
  filter: SourceFilter
}

const memory = new Map<string, PageMemory>()

function remembered(workspaceId: string): PageMemory {
  return memory.get(workspaceId) ?? { section: FIRST_SECTION, query: '', filter: ALL_SOURCES }
}

/** Workspace `workspaceId`'s section, query and filter, kept for the next time its page shows. */
export function useAgentSetupMemory(workspaceId: string): {
  section: AgentSetupSectionId
  setSection: (section: AgentSetupSectionId) => void
  query: string
  setQuery: (query: string) => void
  filter: SourceFilter
  setFilter: (filter: SourceFilter) => void
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
    setFilter: useCallback((filter) => update({ filter }), [update])
  }
}
