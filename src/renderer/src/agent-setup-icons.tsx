import {
  Activity,
  Bot,
  BookText,
  Box,
  ChartColumn,
  LayoutDashboard,
  Puzzle,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareSlash,
  Webhook,
  type LucideIcon
} from 'lucide-react'
import { AGENT_SETUP_GROUPS, type AgentSetupSectionId } from '../../core/agent-setup-sections'

/** Each Agent setup section's icon, in the section list, its title and Overview's cards. */
const SECTION_ICONS: Record<AgentSetupSectionId, LucideIcon> = {
  overview: LayoutDashboard,
  status: Activity,
  stats: ChartColumn,
  plugins: Puzzle,
  mcp: Server,
  skills: Sparkles,
  agents: Bot,
  commands: SquareSlash,
  hooks: Webhook,
  memory: BookText,
  permissions: ShieldCheck,
  sandbox: Box,
  config: SlidersHorizontal
}

/** The theme colour of a section's group (`data-tone`), so each group reads apart in every theme. */
const TONES = ['accent', 'working', 'waiting', 'question'] as const
type SectionTone = (typeof TONES)[number]

function sectionTone(id: AgentSetupSectionId): SectionTone {
  const group = AGENT_SETUP_GROUPS.findIndex((g) => g.some((s) => s.id === id))
  return TONES[group] ?? 'accent'
}

/** A section's icon on its group's theme colour: a tile, or bare in the section list. */
export function SectionIcon({
  id,
  small = false
}: {
  id: AgentSetupSectionId
  small?: boolean
}): React.JSX.Element {
  const Icon = SECTION_ICONS[id]
  return (
    <span
      className={small ? 'agent-setup-icon agent-setup-icon-small' : 'agent-setup-icon'}
      data-tone={sectionTone(id)}
      aria-hidden="true"
    >
      <Icon size={small ? 15 : 18} />
    </span>
  )
}
