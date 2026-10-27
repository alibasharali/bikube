/**
 * The Agent setup page's sections (#68 D7): their ids, names and groups, in the section list's
 * order, and the keyboard's step through them. Plain TS with no DOM imports: the renderer runs it.
 */

export type AgentSetupSectionId =
  | 'overview'
  | 'status'
  | 'stats'
  | 'plugins'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'hooks'
  | 'memory'
  | 'permissions'
  | 'config'

export interface AgentSetupSection {
  id: AgentSetupSectionId
  label: string
}

const section = (id: AgentSetupSectionId, label: string): AgentSetupSection => ({ id, label })

/** The four groups, separated by a rule in the list (a gap in the narrow strip). */
export const AGENT_SETUP_GROUPS: readonly (readonly AgentSetupSection[])[] = [
  [section('overview', 'Overview'), section('status', 'Status'), section('stats', 'Stats')],
  [section('plugins', 'Plugins'), section('mcp', 'MCP servers')],
  [
    section('skills', 'Skills'),
    section('agents', 'Agents'),
    section('commands', 'Commands'),
    section('hooks', 'Hooks')
  ],
  [section('memory', 'Memory'), section('permissions', 'Permissions'), section('config', 'Config')]
]

/** Every section in list order. */
export const AGENT_SETUP_SECTIONS: readonly AgentSetupSection[] = AGENT_SETUP_GROUPS.flat()

/** The section shown the first time a workspace's page opens. */
export const FIRST_SECTION: AgentSetupSectionId = 'overview'

/** The section `step` places after `id` in list order (Down/Right +1, Up/Left −1), wrapping. */
export function adjacentSection(id: AgentSetupSectionId, step: 1 | -1): AgentSetupSectionId {
  const count = AGENT_SETUP_SECTIONS.length
  const at = AGENT_SETUP_SECTIONS.findIndex((s) => s.id === id)
  return AGENT_SETUP_SECTIONS[(at + step + count) % count]!.id
}
