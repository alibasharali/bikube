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
  | 'sandbox'
  | 'config'

export interface AgentSetupSection {
  id: AgentSetupSectionId
  label: string
  /** One line under the section's title saying what it lists. */
  hint: string
}

const HINTS: Record<AgentSetupSectionId, string> = {
  overview: 'Everything Claude Code gets in this workspace, and what needs a look',
  status: 'The Claude Code install, account and settings files',
  stats: "This workspace's Claude Code sessions over the last 30 days",
  plugins: 'Installed plugins, turned on or off for this workspace',
  mcp: 'Servers Claude Code can connect to, never started from here',
  skills: 'Skills Claude Code can load when a task calls for one',
  agents: 'Subagents Claude Code can hand work to',
  commands: 'Slash commands typed at the prompt',
  hooks: 'Commands run on Claude Code events, by event',
  memory: 'Instruction files loaded at the start of every session, in load order',
  permissions: 'Tool rules: allowed, asked about and denied',
  sandbox: "Where Claude Code's Bash sandbox lets commands write, read and connect",
  config: 'Settings keys and where each value comes from'
}

const section = (id: AgentSetupSectionId, label: string): AgentSetupSection => ({
  id,
  label,
  hint: HINTS[id]
})

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
  [
    section('memory', 'Memory'),
    section('permissions', 'Permissions'),
    section('sandbox', 'Sandbox'),
    section('config', 'Config')
  ]
]

/** Each group's name, shown above it in the vertical list. */
export const AGENT_SETUP_GROUP_NAMES: readonly string[] = [
  'Workspace',
  'Extensions',
  'Capabilities',
  'Context'
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

/** A collapsible group's key in the page memory (#71 D9): its section and its name. */
export const collapsedGroupKey = (section: AgentSetupSectionId, name: string): string =>
  `${section}\n${name}`

/**
 * `collapsed` with section `section`'s group `name` collapsed if it was open, opened if it was
 * collapsed (#71 D9). A new set: the one given is left as it is.
 */
export function toggleCollapsedGroup(
  collapsed: ReadonlySet<string>,
  section: AgentSetupSectionId,
  name: string
): ReadonlySet<string> {
  const key = collapsedGroupKey(section, name)
  const next = new Set(collapsed)
  if (!next.delete(key)) next.add(key)
  return next
}
