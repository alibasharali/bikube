import { useCallback, useState } from 'react'
import { FIRST_SECTION, type AgentSetupSectionId } from '../../core/agent-setup-sections'

/**
 * Each workspace's Agent setup page as it was left, for this run of the app: the section shown
 * (#68 D7, Overview the first time) and the search query (D25). Runtime only: never saved or
 * synced.
 */
interface PageMemory {
  section: AgentSetupSectionId
  query: string
}

const memory = new Map<string, PageMemory>()

function remembered(workspaceId: string): PageMemory {
  return memory.get(workspaceId) ?? { section: FIRST_SECTION, query: '' }
}

/** Workspace `workspaceId`'s section and query, kept for the next time its page shows. */
export function useAgentSetupMemory(workspaceId: string): {
  section: AgentSetupSectionId
  setSection: (section: AgentSetupSectionId) => void
  query: string
  setQuery: (query: string) => void
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
    setQuery: useCallback((query) => update({ query }), [update])
  }
}
