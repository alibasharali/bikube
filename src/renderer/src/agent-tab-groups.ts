import { useSyncExternalStore } from 'react'

/** The Agent tab's groups (#75 D6), in order under its header. */
export const AGENT_TAB_GROUPS = [
  { id: 'agents', name: 'Agents' },
  { id: 'changes', name: 'What changed' },
  { id: 'commands', name: 'Commands' }
] as const

export type AgentTabGroupId = (typeof AGENT_TAB_GROUPS)[number]['id']

/**
 * The groups the user collapsed, for every card and shell alike and for the run of the app only
 * (D6): all open the first time and after a restart. A new set on every change.
 */
let collapsed: ReadonlySet<AgentTabGroupId> = new Set()
const listeners = new Set<() => void>()

export const collapsedAgentGroups = (): ReadonlySet<AgentTabGroupId> => collapsed

/** Collapses an open group, or opens a collapsed one. */
export function toggleAgentGroup(id: AgentTabGroupId): void {
  const next = new Set(collapsed)
  if (!next.delete(id)) next.add(id)
  collapsed = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useCollapsedAgentGroups = (): ReadonlySet<AgentTabGroupId> =>
  useSyncExternalStore(subscribe, collapsedAgentGroups)
