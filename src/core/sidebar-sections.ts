/**
 * The Split sidebar's sections (#79 D2–D4, D9): which running cards and shells are agent rows,
 * the plain terminals still nested under each workspace, the Agents section's groups, and the
 * numbers a held terminal modifier shows. Plain TS with no DOM imports: the renderer runs it.
 */
import type { Activity } from './activity'
import { isAgentKind } from './agent-presets'
import type { OpenTerminal } from './open-terminals'

export type AgentGroupId = 'needsYou' | 'working' | 'idle'

export interface AgentGroup {
  id: AgentGroupId
  label: string
  /** Its rows in the Nested order: workspaces in sidebar order, then each one's own order. */
  rows: OpenTerminal[]
}

export interface SidebarSections {
  /** Each workspace's plain terminals, by workspace id; a workspace with none has no entry. */
  nested: ReadonlyMap<string, OpenTerminal[]>
  /** The Agents section's groups in D4's order, an empty group left out. */
  agents: AgentGroup[]
  /** The active workspace's first nine rows by card id, numbered as Ctrl+digit picks them (D9). */
  numbers: ReadonlyMap<string, number>
}

const GROUPS: readonly { id: AgentGroupId; label: string }[] = [
  { id: 'needsYou', label: 'Needs you' },
  { id: 'working', label: 'Working' },
  { id: 'idle', label: 'Idle' }
]

/** How many rows a digit can pick. */
const DIGITS = 9

/** The group an activity puts an agent row in (D4). */
export function agentGroupOf(activity: Activity | undefined): AgentGroupId {
  if (activity === 'waiting' || activity === 'question') return 'needsYou'
  return activity === 'working' ? 'working' : 'idle'
}

/**
 * Whether a running card or shell is an agent row (D2): a card started as Claude Code or an agent
 * preset (rule 1), one running Claude Code in its main pane now (rule 2, `claudeRunning`), or one
 * with an activity set (rule 3).
 */
export function isAgentRow(row: OpenTerminal, claudeRunning = false): boolean {
  if (row.kind === 'card' && (row.tool === 'claude' || isAgentKind(row.tool))) return true
  return claudeRunning || row.activity !== undefined
}

/**
 * Splits the open terminals (in `openTerminals`' Nested order) into the Workspaces section's
 * nested rows and the Agents section's groups, and numbers the active workspace's rows in that
 * same order, wherever each shows.
 */
export function sidebarSections(
  terminals: readonly OpenTerminal[],
  isAgent: (row: OpenTerminal) => boolean,
  activeId: string | null
): SidebarSections {
  const nested = new Map<string, OpenTerminal[]>()
  const grouped = new Map<AgentGroupId, OpenTerminal[]>(GROUPS.map((g) => [g.id, []]))
  const numbers = new Map<string, number>()
  for (const row of terminals) {
    if (row.workspaceId === activeId && numbers.size < DIGITS) {
      numbers.set(row.cardId, numbers.size + 1)
    }
    if (isAgent(row)) grouped.get(agentGroupOf(row.activity))?.push(row)
    else nested.set(row.workspaceId, [...(nested.get(row.workspaceId) ?? []), row])
  }
  const agents = GROUPS.map((g) => ({ ...g, rows: grouped.get(g.id) ?? [] })).filter(
    (g) => g.rows.length > 0
  )
  return { nested, agents, numbers }
}
